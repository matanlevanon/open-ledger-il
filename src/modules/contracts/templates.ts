import { type AuditActor, actorBiz, auditStatement } from '../../core/audit';
import { settingKey } from '../../core/business';
import { all, first, nowIso, stmt, transaction } from '../../core/db';
import { NotFoundError, ValidationError } from '../../core/errors';
import { tokensIn } from './markdown';
import { seedFor } from './seed';
import {
  BUSINESS_SOURCES,
  CLIENT_SOURCES,
  type FieldDef,
  fieldDef,
  MODEL_LABELS,
  OWNER_INPUT_TYPES,
  type ServiceInput,
  type ServiceModel,
  SIGNER_INPUT_TYPES,
  type TemplateInput,
  type TemplateKind,
  type TemplateRow,
  type TemplateVersionRow,
} from './types';

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

const SEEDED_KEY = 'contracts.seeded';

/**
 * Seeds a business's templates and services the first time Contract templates opens. The seeded
 * flag is the first statement of the batch, so two requests at once seed once: the second batch
 * fails on the flag's primary key and is ignored.
 */
export async function ensureSeeded(db: D1Database, businessId: number): Promise<void> {
  const key = settingKey(businessId, SEEDED_KEY);
  if (await first(db, 'SELECT 1 FROM settings WHERE key = ?', key)) return;
  if ((await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM businesses WHERE id = ?', businessId))?.n !== 1) return;
  const seed = seedFor(businessId);
  const now = nowIso();
  const statements: D1PreparedStatement[] = [stmt(db, 'INSERT INTO settings (key, value) VALUES (?, ?)', key, now)];
  seed.services.forEach((s, i) => {
    statements.push(
      stmt(
        db,
        `INSERT INTO contract_services (business_id, name_en, name_he, model, model_label_en, description_en, description_he, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        businessId,
        s.nameEn,
        s.nameHe,
        s.model,
        s.modelLabelEn ?? null,
        s.descriptionEn,
        s.descriptionHe,
        i + 1,
      ),
    );
    s.items.forEach((item, j) => {
      statements.push(
        stmt(
          db,
          `INSERT INTO contract_service_items (service_id, business_id, label_en, label_he, sort_order)
           VALUES ((SELECT id FROM contract_services WHERE business_id = ? AND sort_order = ? ORDER BY id DESC LIMIT 1), ?, ?, ?, ?)`,
          businessId,
          i + 1,
          businessId,
          item.labelEn,
          item.labelHe,
          j + 1,
        ),
      );
    });
  });
  for (const t of seed.templates) {
    statements.push(stmt(db, 'INSERT INTO contract_templates (business_id, name, kind, current_version) VALUES (?, ?, ?, 1)', businessId, t.name, t.kind));
    statements.push(
      stmt(
        db,
        `INSERT INTO contract_template_versions (template_id, business_id, version, name, kind, body_en, body_he, fields_json)
         VALUES ((SELECT MAX(id) FROM contract_templates WHERE business_id = ?), ?, 1, ?, ?, ?, ?, ?)`,
        businessId,
        businessId,
        t.name,
        t.kind,
        t.bodyEn,
        t.bodyHe,
        JSON.stringify(t.fields),
      ),
    );
  }
  try {
    await transaction(db, statements);
  } catch (err) {
    // Another request seeded first.
    if (await first(db, 'SELECT 1 FROM settings WHERE key = ?', key)) return;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Field checks
// ---------------------------------------------------------------------------

/** Checks a field list against its bodies. Every token needs a field, keys are unique. */
export function checkFields(fields: FieldDef[], bodies: string[]): FieldDef[] {
  const parsed = fields.map((x) => fieldDef.parse(x));
  const keys = new Set<string>();
  for (const field of parsed) {
    if (keys.has(field.key)) throw new ValidationError(`The field key ${field.key} is used twice.`);
    keys.add(field.key);
    if (field.kind === 'client' && !(CLIENT_SOURCES as readonly string[]).includes(field.source ?? '')) throw new ValidationError(`Pick what ${field.key} reads from the client.`);
    if (field.kind === 'business' && !(BUSINESS_SOURCES as readonly string[]).includes(field.source ?? '')) throw new ValidationError(`Pick what ${field.key} reads from the business.`);
    if (field.kind === 'owner_input' && !(OWNER_INPUT_TYPES as readonly string[]).includes(field.inputType ?? '')) throw new ValidationError(`Pick an input type for ${field.key}.`);
    if (field.kind === 'signer_input' && !(SIGNER_INPUT_TYPES as readonly string[]).includes(field.inputType ?? '')) throw new ValidationError(`Pick an input type for ${field.key}.`);
    if ((field.kind === 'signature' || field.kind === 'signed_date') && !field.party) throw new ValidationError(`Pick whose ${field.kind === 'signature' ? 'signature' : 'date'} ${field.key} is.`);
    if (field.kind === 'choice' && field.binding !== 'services' && field.options.length === 0) throw new ValidationError(`Add at least one option to ${field.key}.`);
  }
  const used = bodies.flatMap((b) => tokensIn(b));
  const unknown = used.filter((k) => !keys.has(k));
  if (unknown.length > 0) throw new ValidationError(`The text uses fields that are not in the list: ${[...new Set(unknown)].join(', ')}.`);
  return parsed;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface TemplateView {
  id: number;
  name: string;
  kind: TemplateKind;
  version: number;
  active: boolean;
  bodyEn: string;
  bodyHe: string;
  fields: FieldDef[];
  fieldCount: number;
  usedCount: number;
  updatedAt: string;
}

function toView(t: TemplateRow, v: TemplateVersionRow, usedCount: number): TemplateView {
  const fields = JSON.parse(v.fields_json) as FieldDef[];
  return {
    id: t.id,
    name: t.name,
    kind: t.kind,
    version: v.version,
    active: t.active === 1,
    bodyEn: v.body_en,
    bodyHe: v.body_he,
    fields,
    fieldCount: fields.length,
    usedCount,
    updatedAt: t.updated_at,
  };
}

export async function listTemplates(db: D1Database, businessId: number): Promise<TemplateView[]> {
  await ensureSeeded(db, businessId);
  const rows = await all<TemplateRow & { v_id: number; used: number }>(
    db,
    `SELECT t.*, v.id AS v_id, (SELECT COUNT(*) FROM contracts c WHERE c.template_id = t.id AND c.status <> 'draft') AS used
     FROM contract_templates t JOIN contract_template_versions v ON v.template_id = t.id AND v.version = t.current_version
     WHERE t.business_id = ? ORDER BY t.active DESC, t.id`,
    businessId,
  );
  const out: TemplateView[] = [];
  for (const r of rows) {
    const v = (await first<TemplateVersionRow>(db, 'SELECT * FROM contract_template_versions WHERE id = ?', r.v_id))!;
    out.push(toView(r, v, r.used));
  }
  return out;
}

export async function getTemplate(db: D1Database, businessId: number, id: number): Promise<TemplateRow> {
  const row = await first<TemplateRow>(db, 'SELECT * FROM contract_templates WHERE id = ? AND business_id = ?', id, businessId);
  if (!row) throw new NotFoundError('Template', id);
  return row;
}

/** One version of a template. Without `version`, the current one. */
export async function templateVersion(db: D1Database, businessId: number, templateId: number, version?: number): Promise<TemplateVersionRow> {
  const t = await getTemplate(db, businessId, templateId);
  const row = await first<TemplateVersionRow>(
    db,
    'SELECT * FROM contract_template_versions WHERE template_id = ? AND version = ? AND business_id = ?',
    t.id,
    version ?? t.current_version,
    businessId,
  );
  if (!row) throw new NotFoundError('Template version', `${templateId}/${version ?? t.current_version}`);
  return row;
}

export async function templateView(db: D1Database, businessId: number, id: number): Promise<TemplateView> {
  const t = await getTemplate(db, businessId, id);
  const v = await templateVersion(db, businessId, id);
  const used = (await first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM contracts WHERE template_id = ? AND status <> 'draft'", id))!.n;
  return toView(t, v, used);
}

export async function createTemplate(db: D1Database, actor: AuditActor, input: TemplateInput): Promise<TemplateView> {
  const businessId = actorBiz(actor);
  const fields = checkFields(input.fields, [input.bodyEn, input.bodyHe]);
  const res = await transaction(db, [
    stmt(db, 'INSERT INTO contract_templates (business_id, name, kind, current_version, active) VALUES (?, ?, ?, 1, ?)', businessId, input.name, input.kind, input.active ? 1 : 0),
    stmt(
      db,
      `INSERT INTO contract_template_versions (template_id, business_id, version, name, kind, body_en, body_he, fields_json, created_by)
       VALUES ((SELECT MAX(id) FROM contract_templates WHERE business_id = ?), ?, 1, ?, ?, ?, ?, ?, ?)`,
      businessId,
      businessId,
      input.name,
      input.kind,
      input.bodyEn,
      input.bodyHe,
      JSON.stringify(fields),
      actor.userId,
    ),
    auditStatement(db, actor, 'contract_template.create', 'contract_template', null, { name: input.name, kind: input.kind }),
  ]);
  return templateView(db, businessId, Number(res[0]!.meta.last_row_id));
}

/**
 * Saves a template. The current version changes in place while no sent contract uses it. Once a
 * sent contract uses it, the edit writes the next version and that contract keeps its own.
 */
export async function updateTemplate(db: D1Database, actor: AuditActor, id: number, input: TemplateInput): Promise<TemplateView> {
  const businessId = actorBiz(actor);
  const t = await getTemplate(db, businessId, id);
  if (input.kind !== t.kind) throw new ValidationError('A template keeps its kind. Make a new template instead.');
  const fields = checkFields(input.fields, [input.bodyEn, input.bodyHe]);
  const used = await first(db, "SELECT 1 FROM contracts WHERE template_id = ? AND template_version = ? AND status <> 'draft' LIMIT 1", id, t.current_version);
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  let version = t.current_version;
  if (used) {
    version = t.current_version + 1;
    statements.push(
      stmt(
        db,
        `INSERT INTO contract_template_versions (template_id, business_id, version, name, kind, body_en, body_he, fields_json, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        businessId,
        version,
        input.name,
        t.kind,
        input.bodyEn,
        input.bodyHe,
        JSON.stringify(fields),
        actor.userId,
      ),
    );
  } else {
    statements.push(
      stmt(
        db,
        'UPDATE contract_template_versions SET name = ?, body_en = ?, body_he = ?, fields_json = ? WHERE template_id = ? AND version = ?',
        input.name,
        input.bodyEn,
        input.bodyHe,
        JSON.stringify(fields),
        id,
        version,
      ),
    );
  }
  statements.push(
    stmt(db, 'UPDATE contract_templates SET name = ?, active = ?, current_version = ?, updated_at = ? WHERE id = ?', input.name, input.active ? 1 : 0, version, now, id),
    auditStatement(db, actor, 'contract_template.update', 'contract_template', id, { version, newVersion: Boolean(used) }),
  );
  await transaction(db, statements);
  return templateView(db, businessId, id);
}

// ---------------------------------------------------------------------------
// Services (the Work Order scope picker)
// ---------------------------------------------------------------------------

export interface ServiceView {
  id: number;
  nameEn: string;
  nameHe: string;
  model: ServiceModel;
  modelLabelEn: string;
  modelLabelHe: string;
  descriptionEn: string;
  descriptionHe: string;
  sortOrder: number;
  active: boolean;
  items: { id: number; labelEn: string; labelHe: string; active: boolean }[];
}

interface ServiceRow {
  id: number;
  business_id: number;
  name_en: string;
  name_he: string;
  model: ServiceModel;
  model_label_en: string | null;
  model_label_he: string | null;
  description_en: string;
  description_he: string;
  sort_order: number;
  active: number;
}

export async function listServices(db: D1Database, businessId: number, opts: { activeOnly?: boolean } = {}): Promise<ServiceView[]> {
  await ensureSeeded(db, businessId);
  const rows = await all<ServiceRow>(
    db,
    `SELECT * FROM contract_services WHERE business_id = ? ${opts.activeOnly ? 'AND active = 1' : ''} ORDER BY sort_order, id`,
    businessId,
  );
  const items = await all<{ id: number; service_id: number; label_en: string; label_he: string; active: number }>(
    db,
    `SELECT id, service_id, label_en, label_he, active FROM contract_service_items WHERE business_id = ? ${opts.activeOnly ? 'AND active = 1' : ''} ORDER BY sort_order, id`,
    businessId,
  );
  return rows.map((r) => ({
    id: r.id,
    nameEn: r.name_en,
    nameHe: r.name_he,
    model: r.model,
    modelLabelEn: r.model_label_en || MODEL_LABELS[r.model].en,
    modelLabelHe: r.model_label_he || MODEL_LABELS[r.model].he,
    descriptionEn: r.description_en,
    descriptionHe: r.description_he,
    sortOrder: r.sort_order,
    active: r.active === 1,
    items: items.filter((i) => i.service_id === r.id).map((i) => ({ id: i.id, labelEn: i.label_en, labelHe: i.label_he, active: i.active === 1 })),
  }));
}

function requireName(input: ServiceInput): void {
  if (!input.nameEn && !input.nameHe) throw new ValidationError('Name the service in English or Hebrew.');
}

export async function createService(db: D1Database, actor: AuditActor, input: ServiceInput): Promise<ServiceView[]> {
  requireName(input);
  const businessId = actorBiz(actor);
  await ensureSeeded(db, businessId);
  const res = await transaction(db, [
    stmt(
      db,
      `INSERT INTO contract_services (business_id, name_en, name_he, model, model_label_en, model_label_he, description_en, description_he, sort_order, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      businessId,
      input.nameEn,
      input.nameHe,
      input.model,
      input.modelLabelEn ?? null,
      input.modelLabelHe ?? null,
      input.descriptionEn,
      input.descriptionHe,
      input.sortOrder,
      input.active ? 1 : 0,
    ),
  ]);
  const id = Number(res[0]!.meta.last_row_id);
  await writeItems(db, actor, id, input, 'contract_service.create');
  return listServices(db, businessId);
}

export async function updateService(db: D1Database, actor: AuditActor, id: number, input: ServiceInput): Promise<ServiceView[]> {
  requireName(input);
  const businessId = actorBiz(actor);
  const row = await first<ServiceRow>(db, 'SELECT * FROM contract_services WHERE id = ? AND business_id = ?', id, businessId);
  if (!row) throw new NotFoundError('Service', id);
  await transaction(db, [
    stmt(
      db,
      `UPDATE contract_services SET name_en = ?, name_he = ?, model = ?, model_label_en = ?, model_label_he = ?, description_en = ?, description_he = ?,
         sort_order = ?, active = ?, updated_at = ? WHERE id = ?`,
      input.nameEn,
      input.nameHe,
      input.model,
      input.modelLabelEn ?? null,
      input.modelLabelHe ?? null,
      input.descriptionEn,
      input.descriptionHe,
      input.sortOrder,
      input.active ? 1 : 0,
      nowIso(),
      id,
    ),
  ]);
  await writeItems(db, actor, id, input, 'contract_service.update');
  return listServices(db, businessId);
}

/** Items with an id update in place. New items insert. Items left out turn off, never deleted. */
async function writeItems(db: D1Database, actor: AuditActor, serviceId: number, input: ServiceInput, action: string): Promise<void> {
  const businessId = actorBiz(actor);
  const existing = await all<{ id: number }>(db, 'SELECT id FROM contract_service_items WHERE service_id = ? AND business_id = ?', serviceId, businessId);
  const keep = new Set(input.items.filter((i) => i.id).map((i) => i.id!));
  const statements: D1PreparedStatement[] = [];
  input.items.forEach((item, idx) => {
    if (item.id) {
      if (!existing.some((e) => e.id === item.id)) throw new ValidationError('A scope item belongs to another service.');
      statements.push(
        stmt(db, 'UPDATE contract_service_items SET label_en = ?, label_he = ?, sort_order = ?, active = ? WHERE id = ?', item.labelEn, item.labelHe, idx + 1, item.active ? 1 : 0, item.id),
      );
    } else if (item.labelEn || item.labelHe) {
      statements.push(
        stmt(
          db,
          'INSERT INTO contract_service_items (service_id, business_id, label_en, label_he, sort_order, active) VALUES (?, ?, ?, ?, ?, ?)',
          serviceId,
          businessId,
          item.labelEn,
          item.labelHe,
          idx + 1,
          item.active ? 1 : 0,
        ),
      );
    }
  });
  for (const e of existing) if (!keep.has(e.id)) statements.push(stmt(db, 'UPDATE contract_service_items SET active = 0 WHERE id = ?', e.id));
  statements.push(auditStatement(db, actor, action, 'contract_service', serviceId, { items: input.items.length }));
  await transaction(db, statements);
}
