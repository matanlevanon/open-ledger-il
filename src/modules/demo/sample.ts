import sampleSet from '../../../demo/seed/sample-set.json';
import { type AuditActor, auditStatement } from '../../core/audit';
import { type AuthUser, FEATURES } from '../../core/auth';
import { seriesIdFor, settingKey } from '../../core/business';
import { all, first, nowIso, run, stmt, transaction } from '../../core/db';
import { convert } from '../../core/money';
import type { Env } from '../../env';
import { addContact, createClient } from '../clients/service';
import { clientInput, contactInput } from '../clients/schemas';
import { placeFields } from '../contracts/fields-pdf';
import { renderContract } from '../contracts/render';
import { contractPdfKey, sha256Hex } from '../contracts/service';
import type { FieldDef, FieldValues } from '../contracts/types';
import { SAMPLE_SEED } from '../contracts/seed';
import { businessFacts, clientValue, expandStartingValue } from '../contracts/values';
import { buildDocumentsServices, type DocumentsModuleOptions } from '../documents';
import { cancelDocument, createDraft, creditDocument, finalize, updateDraft, type Ctx } from '../documents/service';
import { draftInput } from '../documents/schemas';
import { switchToMurshe } from '../legal-mode/service';
import { signPdf } from '../signing';
import { DEMO_SIGNING_CERT_PEM, DEMO_SIGNING_KEY_PEM } from './demo-cert';
import { MASTER_OWNER_EMAIL } from './config';
import { samplePng } from './png';
import { TextPdfEngine } from './text-pdf';

/**
 * R26, R29: the master sample set (demo/seed/sample-set.json). Every visitor opens these same
 * businesses, read-only. There is no per-visitor copy.
 *
 * The masters load through the Ledger's own services, so numbering and the hash chain are real.
 * They build once at a time, under a lock, and a business is listed in demo_master_businesses only
 * after it is complete. A fingerprint taken then lets the nightly reset see a changed or broken
 * sample set and rebuild only that.
 */

type Spec = (typeof sampleSet.businesses)[number];
type DocSpec = Spec['documents'][number] & { currency?: string; overrideRate?: string; dueDays?: number; pay?: string; cancel?: string; of?: string; amountMinor?: number; reason?: string };

export const SAMPLE_VERSION = sampleSet.version;
const BASE_SERIES = ['QT', 'PR', 'PF', '300', '400', '405'];
const BACKDATE = 'Sample data for the demo.';

export interface SampleDeps {
  env: Env;
  documentsOptions?: DocumentsModuleOptions;
  now?: () => Date;
}

const DAY = 24 * 60 * 60 * 1000;
/** daysAgo counts back from today: the newest sample, daysAgo 1, lands yesterday. */
const dateAgo = (now: Date, daysAgo: number) => new Date(now.getTime() - daysAgo * DAY).toISOString().slice(0, 10);

interface Owner {
  userId: number;
  email: string;
}

async function ensureUser(db: D1Database, email: string): Promise<number> {
  await run(db, "INSERT OR IGNORE INTO users (email, role) VALUES (?, 'owner')", email);
  return (await first<{ id: number }>(db, 'SELECT id FROM users WHERE email = ?', email))!.id;
}

export async function ensureMasterOwner(db: D1Database): Promise<Owner> {
  return { userId: await ensureUser(db, MASTER_OWNER_EMAIL), email: MASTER_OWNER_EMAIL };
}

function actorFor(owner: Owner, businessId: number): AuditActor {
  return { userId: owner.userId, email: owner.email, role: 'owner', ip: null, userAgent: null, businessId };
}

async function userFor(db: D1Database, owner: Owner, businessId: number): Promise<AuthUser> {
  const grants = await all<{ business_id: number }>(db, "SELECT business_id FROM user_businesses WHERE user_id = ? AND role = 'owner'", owner.userId);
  return {
    id: owner.userId,
    email: owner.email,
    name: null,
    role: 'owner',
    features: [...FEATURES],
    theme: null,
    locale: null,
    businessId,
    businesses: grants.map((g) => ({ id: g.business_id, role: 'owner' as const })),
  };
}

/**
 * A business row, its default brand, a פטור legal mode, the base series and the owner grant: the
 * same rows Add business writes. The one-עוסק rule is the Ledger's rule for one real person. The
 * sample businesses are not people, so the build writes the rows itself.
 */
async function insertBusiness(db: D1Database, owner: Owner, spec: Spec): Promise<number> {
  const base = await all<{ id: string; doc_type: string; name_en: string; name_he: string | null; legal_mode: string | null }>(
    db,
    `SELECT id, doc_type, name_en, name_he, legal_mode FROM series WHERE business_id = 1 AND id IN (${BASE_SERIES.map(() => '?').join(',')})`,
    ...BASE_SERIES,
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = (await first<{ id: number }>(db, 'SELECT COALESCE(MAX(id), 0) + 1 AS id FROM businesses'))!.id;
    try {
      await transaction(db, [
        stmt(
          db,
          `INSERT INTO businesses (id, name_en, name_he, tax_id, address_en, address_he, email, phone, entity_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'osek_patur')`,
          id,
          spec.nameEn,
          spec.nameHe,
          spec.taxId,
          spec.addressEn,
          spec.addressHe,
          spec.email,
          spec.phone,
        ),
        stmt(db, 'INSERT INTO brands (business_id, is_default) VALUES (?, 1)', id),
        stmt(db, "INSERT INTO legal_modes (business_id, mode, effective_from, note) VALUES (?, 'patur', '2020-01-01', 'עוסק פטור until the confirmed switch')", id),
        ...base.map((s) =>
          stmt(db, 'INSERT INTO series (id, doc_type, name_en, name_he, legal_mode, business_id) VALUES (?, ?, ?, ?, ?, ?)', seriesIdFor(id, s.id), s.doc_type, s.name_en, s.name_he, s.legal_mode, id),
        ),
        stmt(db, "INSERT INTO user_businesses (user_id, business_id, role, granted_by) VALUES (?, ?, 'owner', ?)", owner.userId, id, owner.userId),
        auditStatement(db, actorFor(owner, id), 'demo.business_copy', 'business', id, { sample: spec.key }),
      ]);
      return id;
    } catch (err) {
      // Another business took the same id at once. Read the next free id and try again.
      if (attempt === 4 || !/UNIQUE|constraint/i.test(String(err instanceof Error ? err.message : err))) throw err;
    }
  }
  throw new Error('unreachable');
}

async function addTemplatesAndServices(db: D1Database, businessId: number, spec: Spec): Promise<void> {
  const statements: D1PreparedStatement[] = [stmt(db, 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', settingKey(businessId, 'contracts.seeded'), nowIso())];
  spec.services.forEach((s, i) => {
    statements.push(
      stmt(db, 'INSERT INTO contract_services (business_id, name_en, model, description_en, sort_order) VALUES (?, ?, ?, ?, ?)', businessId, s.nameEn, s.model, s.descriptionEn, i + 1),
    );
    s.items.forEach((label, j) =>
      statements.push(
        stmt(
          db,
          `INSERT INTO contract_service_items (service_id, business_id, label_en, sort_order)
           VALUES ((SELECT id FROM contract_services WHERE business_id = ? AND sort_order = ?), ?, ?, ?)`,
          businessId,
          i + 1,
          businessId,
          label,
          j + 1,
        ),
      ),
    );
  });
  // The same neutral Service Agreement and Work Order every new business starts with.
  for (const t of SAMPLE_SEED.templates) {
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
  await transaction(db, statements);
}

async function addClients(db: D1Database, owner: Owner, businessId: number, spec: Spec): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  const actor = actorFor(owner, businessId);
  for (const c of spec.clients as (Spec['clients'][number] & Record<string, unknown>)[]) {
    const input = clientInput.parse({
      nameEn: c.nameEn,
      nameHe: c.nameHe ?? null,
      companyId: c.companyId ?? null,
      vatNumber: c.vatNumber ?? null,
      country: c.country,
      foreignResident: c.foreignResident ?? false,
      currency: c.currency ?? 'ILS',
      email: c.email ?? null,
      phone: c.phone ?? null,
      addressEn: c.addressEn ?? null,
    });
    const id = await createClient(db, actor, input);
    const contact = c.contact as { name: string; role: string; email: string; phone: string } | undefined;
    if (contact) await addContact(db, actor, id, contactInput.parse({ ...contact, isPrimary: true }));
    ids.set(c.key, id);
  }
  return ids;
}

async function addDocuments(deps: SampleDeps, owner: Owner, businessId: number, spec: Spec, clients: Map<string, number>, now: Date): Promise<number> {
  const db = deps.env.DB;
  const ctx: Ctx = { db, actor: actorFor(owner, businessId), user: await userFor(db, owner, businessId), services: buildDocumentsServices(deps.documentsOptions ?? {}, deps.env) };
  const refs = new Map<string, number>();
  for (const d of spec.documents as DocSpec[]) {
    const date = dateAgo(now, d.daysAgo);
    if (d.type === 'credit') {
      const source = refs.get(d.of ?? '');
      if (!source) continue;
      await creditDocument(ctx, source, { mode: 'partial', amountMinor: d.amountMinor, date, reason: d.reason ?? null, finalize: true, backdateReason: BACKDATE });
      continue;
    }
    const input = draftInput.parse({
      type: d.type,
      clientId: clients.get(d.client ?? '') ?? null,
      date,
      dueDate: d.dueDays ? dateAgo(now, d.daysAgo - d.dueDays) : null,
      currency: d.currency ?? 'ILS',
      lines: (d.lines ?? []).map((l) => ({ description: l.description, unitPriceMinor: l.unitPriceMinor, quantityMilli: 1000 })),
      overrideRate: d.overrideRate ?? (d.currency && d.currency !== 'ILS' ? (d.currency === 'EUR' ? '4.000000' : '3.700000') : null),
    });
    const id = await createDraft(ctx, input);
    if (d.pay) {
      // A receipt's total follows its payments. A tax invoice receipt's follows its lines with VAT.
      const stored = (await first<{ total_minor: number }>(db, 'SELECT total_minor FROM documents WHERE id = ?', id))!.total_minor;
      const total = stored > 0 ? stored : (d.lines ?? []).reduce((sum, l) => sum + l.unitPriceMinor, 0);
      await updateDraft(ctx, id, { payments: [{ method: d.pay as 'bank_transfer', paidOn: date, amountMinor: total, chequeCrossed: false }] });
    }
    await finalize(ctx, id, { backdateReason: BACKDATE });
    if (d.cancel) await cancelDocument(ctx, id, d.cancel);
    refs.set(d.ref, id);
  }
  return refs.size;
}

async function categoryId(db: D1Database, key: string): Promise<number | null> {
  return (await first<{ id: number }>(db, 'SELECT id FROM expense_categories WHERE key = ?', key))?.id ?? null;
}

async function addMasterExpenses(env: Env, businessId: number, spec: Spec, now: Date): Promise<void> {
  const db = env.DB;
  const suppliers = new Map<string, number>();
  let shade = 10;
  for (const e of spec.expenses as (Spec['expenses'][number] & { vatMinor?: number; currency?: string; status?: string })[]) {
    if (!suppliers.has(e.supplier)) {
      const res = await run(db, 'INSERT INTO suppliers (name, country, business_id) VALUES (?, ?, ?)', e.supplier, e.currency === 'USD' ? 'US' : 'IL', businessId);
      suppliers.set(e.supplier, res.lastRowId);
    }
    const png = samplePng(120, 160, (shade += 17) % 200);
    const sha = await sha256Hex(png);
    const key = `business/${businessId}/expenses/${sha}.png`;
    if (!(await env.FILES.head(key))) await env.FILES.put(key, png, { httpMetadata: { contentType: 'image/png' } });
    const file = await run(
      db,
      "INSERT INTO expense_files (source, r2_key, filename, content_type, size_bytes, sha256, business_id) VALUES ('upload', ?, ?, 'image/png', ?, ?, ?)",
      key,
      `receipt-${e.number}.png`,
      png.byteLength,
      sha,
      businessId,
    );
    const currency = e.currency ?? 'ILS';
    const rate = currency === 'ILS' ? null : '3.700000';
    const expense = await run(
      db,
      `INSERT INTO expenses (file_id, supplier_id, category_id, status, document_number, document_date, document_type, currency, amount_minor, vat_amount_minor,
         amount_ils_minor, fx_rate, fx_rate_date, fx_source, notes, business_id)
       VALUES (?, ?, ?, ?, ?, ?, 'invoice', ?, ?, ?, ?, ?, ?, ?, 'Sample receipt', ?)`,
      file.lastRowId,
      suppliers.get(e.supplier)!,
      await categoryId(db, e.category),
      e.status ?? 'filed',
      e.number,
      dateAgo(now, e.daysAgo),
      currency,
      e.amountMinor,
      e.vatMinor ?? 0,
      rate ? convert(e.amountMinor, rate) : e.amountMinor,
      rate,
      rate ? dateAgo(now, e.daysAgo) : null,
      rate ? 'manual' : null,
      businessId,
    );
    await run(db, 'UPDATE expense_files SET expense_id = ? WHERE id = ?', expense.lastRowId, file.lastRowId);
  }
}

// ---------------------------------------------------------------------------
// Sample contracts (masters only). Rendered with the plain engine and the demo certificate.
// ---------------------------------------------------------------------------

async function storePdf(env: Env, businessId: number, bytes: Uint8Array): Promise<{ key: string; sha256: string }> {
  const sha256 = await sha256Hex(bytes);
  const key = contractPdfKey(businessId, sha256);
  if (!(await env.FILES.head(key))) await env.FILES.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });
  return { key, sha256 };
}

async function addMasterContracts(env: Env, owner: Owner, businessId: number, spec: Spec, clients: Map<string, number>, now: Date): Promise<void> {
  const db = env.DB;
  const engine = new TextPdfEngine();
  const facts = await businessFacts(db, businessId, null);
  for (const c of spec.contracts) {
    const template = (await first<{ id: number; kind: 'contract' | 'work_order' }>(db, 'SELECT id, kind FROM contract_templates WHERE business_id = ? AND name = ?', businessId, c.template))!;
    const version = (await first<{ body_en: string; body_he: string; fields_json: string }>(db, 'SELECT body_en, body_he, fields_json FROM contract_template_versions WHERE template_id = ? AND version = 1', template.id))!;
    const fields = JSON.parse(version.fields_json) as FieldDef[];
    const clientId = clients.get(c.client)!;
    const client = (await first<import('../clients/service').ClientRow>(db, 'SELECT * FROM clients WHERE id = ?', clientId))!;
    const sentAt = new Date(now.getTime() - c.daysAgo * DAY + 9 * 3600_000);
    const values: FieldValues = {};
    for (const f of fields) {
      if (f.kind === 'client') values[f.key] = clientValue(client, null, f.source);
      else if (f.kind === 'business') values[f.key] = f.source === 'name' ? facts.nameEn : '';
      else if (f.kind === 'owner_input' && f.inputType === 'date') values[f.key] = dateAgo(now, c.daysAgo - 5);
      else if (f.kind === 'owner_input') values[f.key] = f.defaultValue ? await expandStartingValue(db, businessId, f.key, f.defaultValue, dateAgo(now, c.daysAgo)) : '';
      else if (f.kind === 'signed_date' && f.party === 'owner') values[f.key] = sentAt.toISOString().slice(0, 10);
      else if (f.kind === 'choice' && f.binding === 'services') {
        const service = (await first<{ id: number; name_en: string; model: string; description_en: string }>(db, 'SELECT * FROM contract_services WHERE business_id = ? ORDER BY sort_order LIMIT 1', businessId))!;
        const items = await all<{ id: number; label_en: string }>(db, 'SELECT id, label_en FROM contract_service_items WHERE service_id = ? ORDER BY sort_order LIMIT 2', service.id);
        values[f.key] = {
          services: [
            {
              serviceId: service.id,
              nameEn: service.name_en,
              nameHe: '',
              modelEn: service.model === 'monthly_retainer' ? 'Monthly retainer' : 'Fixed fee',
              modelHe: '',
              descriptionEn: service.description_en,
              descriptionHe: '',
              items: items.map((i) => ({ itemId: i.id, labelEn: i.label_en, labelHe: '' })),
              other: null,
              note: null,
              fee: { amountMinor: 450000, currency: 'ILS' },
            },
          ],
        };
      }
    }
    const identity = { nameEn: facts.nameEn, nameHe: facts.nameHe };
    const ownerSig = samplePng(120, 40, 30);
    const clientSig = samplePng(120, 40, 60);
    const base = { title: c.title, kind: template.kind, language: 'en' as const, bodyEn: version.body_en, bodyHe: version.body_he, fields, identity, mode: 'pdf' as const };
    const sentRender = renderContract({ ...base, values });
    const sentPdf = (await placeFields(new Uint8Array(await engine.renderPdf(sentRender.html)), sentRender.boxes, { lock: (b) => b.group === 'owner' || b.group === 'owner_signature', signatureImages: Object.fromEntries(fields.filter((f) => f.kind === 'signature' && f.party === 'owner').map((f) => [f.key, ownerSig])) })).bytes;
    const sent = await storePdf(env, businessId, sentPdf);
    const expiresAt = new Date(sentAt.getTime() + 30 * DAY).toISOString();
    const ins = await run(
      db,
      `INSERT INTO contracts (business_id, client_id, template_id, template_version, kind, title, language, field_values_json, signer_name, signer_email, link_days, owner_sign, created_by, created_at)
       VALUES (?, ?, ?, 1, ?, ?, 'en', ?, ?, ?, 30, 1, ?, ?)`,
      businessId,
      clientId,
      template.id,
      template.kind,
      c.title,
      JSON.stringify(values),
      c.signer.name,
      c.signer.email,
      owner.userId,
      sentAt.toISOString(),
    );
    const id = ins.lastRowId;
    const row = { id, business_id: businessId };
    const ev = (kind: string, at: Date, actor: string, role: string, details: Record<string, unknown> | null, ip: string | null = null, ua: string | null = null) =>
      stmt(db, 'INSERT INTO contract_events (contract_id, business_id, kind, actor_email, actor_role, ip, user_agent, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', row.id, row.business_id, kind, actor, role, ip, ua, details ? JSON.stringify(details) : null, at.toISOString());
    const statements = [
      ev('created', sentAt, owner.email, 'owner', { templateVersion: 1 }),
      ev('owner_signed', sentAt, owner.email, 'owner', { name: facts.nameEn }),
      ev('sent', sentAt, owner.email, 'owner', { channel: 'email', to: c.signer.email, sha256: sent.sha256, expiresAt }),
      stmt(db, "UPDATE contracts SET status = 'sent', sent_at = ?, expires_at = ?, sent_pdf_r2_key = ?, sent_pdf_sha256 = ?, owner_signed_at = ?, owner_signed_by = ? WHERE id = ?", sentAt.toISOString(), expiresAt, sent.key, sent.sha256, sentAt.toISOString(), owner.userId, id),
    ];
    const viewedAt = new Date(sentAt.getTime() + 20 * 3600_000);
    if (c.state !== 'sent') {
      statements.push(ev('viewed', viewedAt, c.signer.email, 'signer', null, '192.0.2.10', 'Mozilla/5.0 (iPhone) Safari (sample)'));
      statements.push(stmt(db, "UPDATE contracts SET status = 'viewed', viewed_at = ? WHERE id = ?", viewedAt.toISOString(), id));
    }
    await transaction(db, statements);
    if (c.state !== 'signed') continue;

    const signedAt = new Date(viewedAt.getTime() + 15 * 60_000);
    const signerValues: Record<string, string> = {};
    for (const f of fields) if (f.kind === 'signer_input') signerValues[f.key] = f.inputType === 'name' ? c.signer.name : f.inputType === 'role' ? c.signer.role : '';
    const finalValues: FieldValues = { ...values, ...signerValues };
    for (const f of fields) if (f.kind === 'signed_date' && f.party === 'client') finalValues[f.key] = signedAt.toISOString().slice(0, 10);
    const signedContentSha256 = await sha256Hex(JSON.stringify({ sentPdfSha256: sent.sha256, signerValues, signatureSha256: await sha256Hex(clientSig), signedAt: signedAt.toISOString() }));
    const events = (await all<{ kind: string; actor_email: string; ip: string | null; user_agent: string | null; created_at: string; details_json: string | null }>(db, 'SELECT * FROM contract_events WHERE contract_id = ? ORDER BY id', id)).map((e) => ({
      at: e.created_at,
      label: e.kind === 'sent' ? `Sent to ${c.signer.email} by email` : e.kind === 'owner_signed' ? `Signed by ${facts.nameEn} (owner)` : e.kind === 'viewed' ? 'Opened' : `Created by ${owner.email}`,
      actor: e.actor_email,
      ip: e.ip,
      userAgent: e.user_agent,
    }));
    events.push({ at: signedAt.toISOString(), label: `Signed by ${c.signer.name}, ${c.signer.role}`, actor: c.signer.email, ip: '192.0.2.10', userAgent: 'Mozilla/5.0 (iPhone) Safari (sample)' });
    const finalRender = renderContract({
      ...base,
      values: finalValues,
      evidence: { contractId: id, title: c.title, templateName: c.template, templateVersion: 1, sentSha256: sent.sha256, signedContentSha256, identity: 'email_code', signerEmail: c.signer.email, events },
    });
    const images: Record<string, Uint8Array> = {};
    for (const f of fields) if (f.kind === 'signature') images[f.key] = f.party === 'owner' ? ownerSig : clientSig;
    const placed = (await placeFields(new Uint8Array(await engine.renderPdf(finalRender.html)), finalRender.boxes, { lock: () => true, signatureImages: images })).bytes;
    const signedPdf = await signPdf(placed, { keyPem: DEMO_SIGNING_KEY_PEM, certPem: DEMO_SIGNING_CERT_PEM, certify: true, signedAt, fieldName: 'ledger_certification', signerName: facts.nameEn, reason: 'Sample contract for the demo.' });
    const signed = await storePdf(env, businessId, signedPdf);
    await transaction(db, [
      stmt(
        db,
        `UPDATE contracts SET status = 'signed', signed_at = ?, signer_values_json = ?, signed_pdf_r2_key = ?, signed_pdf_sha256 = ?, signed_content_sha256 = ?, identity_method = 'email_code' WHERE id = ?`,
        signedAt.toISOString(),
        JSON.stringify(signerValues),
        signed.key,
        signed.sha256,
        signedContentSha256,
        id,
      ),
      ev('code_sent', new Date(viewedAt.getTime() + 5 * 60_000), c.signer.email, 'signer', { to: c.signer.email }, '192.0.2.10', 'Mozilla/5.0 (iPhone) Safari (sample)'),
      ev('code_confirmed', new Date(viewedAt.getTime() + 10 * 60_000), c.signer.email, 'signer', { to: c.signer.email }, '192.0.2.10', 'Mozilla/5.0 (iPhone) Safari (sample)'),
      ev('signed', signedAt, c.signer.email, 'signer', { name: c.signer.name, role: c.signer.role, sha256: signed.sha256, certified: true, signedContentSha256 }, '192.0.2.10', 'Mozilla/5.0 (iPhone) Safari (sample)'),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Masters
// ---------------------------------------------------------------------------

export async function masterBusinesses(db: D1Database): Promise<{ business_id: number; sample_key: string; seed_version: number; fingerprint: string | null }[]> {
  return all(db, 'SELECT business_id, sample_key, seed_version, fingerprint FROM demo_master_businesses ORDER BY business_id');
}

/** True when both masters exist at the current seed version. */
export async function mastersCurrent(db: D1Database): Promise<boolean> {
  const rows = await masterBusinesses(db);
  return sampleSet.businesses.every((b) => rows.some((r) => r.sample_key === b.key && r.seed_version >= SAMPLE_VERSION));
}

async function buildBusiness(deps: SampleDeps, owner: Owner, spec: Spec, now: Date): Promise<{ businessId: number; clients: Map<string, number> }> {
  const db = deps.env.DB;
  const businessId = await insertBusiness(db, owner, spec);
  if (spec.entityType !== 'osek_patur') {
    const registered = dateAgo(now, (spec as Spec & { registeredDaysAgo?: number }).registeredDaysAgo ?? 200);
    await switchToMurshe(
      deps.env,
      { documentsOptions: deps.documentsOptions ?? {} },
      { kind: 'registered', effectiveDate: registered, reason: null, repriceDrafts: false, target: 'company', businessId },
      await userFor(db, owner, businessId),
      actorFor(owner, businessId),
    );
  }
  await addTemplatesAndServices(db, businessId, spec);
  const clients = await addClients(db, owner, businessId, spec);
  await addDocuments(deps, owner, businessId, spec, clients, now);
  return { businessId, clients };
}

// The fingerprint: the sample rows that matter, never a visitor's draft, never a viewed PDF's hash.
const SAMPLE_ONLY = 'AND demo_session_id IS NULL';
const FINGERPRINT_SQL = [
  'SELECT id, name_en, name_he, tax_id, entity_type FROM businesses WHERE id = ?1',
  `SELECT id, name_en, name_he, email, phone, country, currency FROM clients WHERE business_id = ?1 ${SAMPLE_ONLY} ORDER BY id`,
  `SELECT id, type, series_id, number, status, date, client_id, total_minor, hash FROM documents WHERE business_id = ?1 ${SAMPLE_ONLY} ORDER BY id`,
  `SELECT COUNT(*) AS n FROM document_lines WHERE document_id IN (SELECT id FROM documents WHERE business_id = ?1 ${SAMPLE_ONLY})`,
  `SELECT COUNT(*) AS n FROM payments WHERE document_id IN (SELECT id FROM documents WHERE business_id = ?1 ${SAMPLE_ONLY})`,
  `SELECT id, status, title, client_id, signed_pdf_sha256 FROM contracts WHERE business_id = ?1 ${SAMPLE_ONLY} ORDER BY id`,
  `SELECT id, status, document_number, amount_minor FROM expenses WHERE business_id = ?1 ${SAMPLE_ONLY} ORDER BY id`,
  'SELECT id, name, current_version FROM contract_templates WHERE business_id = ?1 ORDER BY id',
];

/** A SHA-256 over the sample rows of one master business. Pass the raw database, never a scoped one. */
export async function fingerprintOf(db: D1Database, businessId: number): Promise<string> {
  const parts: string[] = [];
  for (const sql of FINGERPRINT_SQL) parts.push(JSON.stringify((await db.prepare(sql).bind(businessId).all()).results));
  return sha256Hex(new TextEncoder().encode(parts.join('\n')));
}

/** After an admin write on the sample set: the change is intended, so it becomes the new reference. */
export async function refreshFingerprint(db: D1Database, businessId: number): Promise<void> {
  if (!(await first(db, 'SELECT 1 FROM demo_master_businesses WHERE business_id = ?', businessId))) return;
  await run(db, 'UPDATE demo_master_businesses SET fingerprint = ? WHERE business_id = ?', await fingerprintOf(db, businessId), businessId);
}

/** The seed's shape: at least the rows it lists. The admin may add, the seed never shrinks. */
async function holdsSeed(db: D1Database, businessId: number, spec: Spec): Promise<boolean> {
  const count = async (sql: string) => (await first<{ n: number }>(db, sql, businessId))!.n;
  return (
    (await count(`SELECT COUNT(*) AS n FROM clients WHERE business_id = ? ${SAMPLE_ONLY}`)) >= spec.clients.length &&
    (await count(`SELECT COUNT(*) AS n FROM documents WHERE business_id = ? AND number IS NOT NULL ${SAMPLE_ONLY}`)) >= spec.documents.length &&
    (await count(`SELECT COUNT(*) AS n FROM expenses WHERE business_id = ? ${SAMPLE_ONLY}`)) >= spec.expenses.length &&
    (await count(`SELECT COUNT(*) AS n FROM contracts WHERE business_id = ? ${SAMPLE_ONLY}`)) >= spec.contracts.length
  );
}

/**
 * The masters that no longer match: missing, older than the seed, short of the seed's rows, or
 * changed since their fingerprint. A master without a fingerprint (built before R29) adopts its
 * current one. Returns the sample keys to rebuild.
 */
export async function staleMasters(db: D1Database): Promise<{ key: string; businessId: number | null }[]> {
  const rows = await masterBusinesses(db);
  const stale: { key: string; businessId: number | null }[] = [];
  for (const spec of sampleSet.businesses) {
    const row = rows.find((r) => r.sample_key === spec.key);
    if (!row || row.seed_version < SAMPLE_VERSION || !(await holdsSeed(db, row.business_id, spec))) {
      stale.push({ key: spec.key, businessId: row?.business_id ?? null });
      continue;
    }
    const current = await fingerprintOf(db, row.business_id);
    if (row.fingerprint === null) await run(db, 'UPDATE demo_master_businesses SET fingerprint = ? WHERE business_id = ?', current, row.business_id);
    else if (row.fingerprint !== current) stale.push({ key: spec.key, businessId: row.business_id });
  }
  return stale;
}

/** A build that has not finished in this time died. The next request takes the lock over. */
export const BUILD_LOCK_MS = 10 * 60_000;

/** Takes the build lock. True for the one caller that got it. One statement, so two callers never both win. */
export async function takeBuildLock(db: D1Database, holder: string, now = new Date()): Promise<boolean> {
  await run(
    db,
    `INSERT INTO demo_build_lock (id, holder, started_at, expires_at) VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET holder = excluded.holder, started_at = excluded.started_at, expires_at = excluded.expires_at
     WHERE demo_build_lock.expires_at <= excluded.started_at`,
    holder,
    now.toISOString(),
    new Date(now.getTime() + BUILD_LOCK_MS).toISOString(),
  );
  return (await first<{ holder: string }>(db, 'SELECT holder FROM demo_build_lock WHERE id = 1'))?.holder === holder;
}

export async function releaseBuildLock(db: D1Database, holder: string): Promise<void> {
  await run(db, 'DELETE FROM demo_build_lock WHERE id = 1 AND holder = ?', holder);
}

/** True while a build holds the lock. */
export async function buildRunning(db: D1Database, now = new Date()): Promise<boolean> {
  return (await first(db, 'SELECT 1 FROM demo_build_lock WHERE id = 1 AND expires_at > ?', now.toISOString())) !== null;
}

export type MastersResult = { ready: true; loaded: boolean; businessIds: number[] } | { ready: false; loaded: false; businessIds: number[] };

/**
 * Loads the masters that are missing or older than the seed, under the build lock. A caller that
 * finds a build running gets ready: false and shows the "Preparing the sample data" page. A
 * master is listed only once it is complete. An older one it replaces becomes an ordinary
 * business, which the next reset removes.
 */
export async function ensureMasters(deps: SampleDeps): Promise<MastersResult> {
  const db = deps.env.DB;
  const listed = async () => (await masterBusinesses(db)).map((r) => r.business_id);
  if (await mastersCurrent(db)) return { ready: true, loaded: false, businessIds: await listed() };
  const holder = crypto.randomUUID();
  if (!(await takeBuildLock(db, holder, deps.now ? deps.now() : new Date()))) return { ready: false, loaded: false, businessIds: [] };
  try {
    // Another caller may have finished between the first check and the lock.
    if (await mastersCurrent(db)) return { ready: true, loaded: false, businessIds: await listed() };
    const now = deps.now ? deps.now() : new Date();
    const owner = await ensureMasterOwner(db);
    const current = await masterBusinesses(db);
    for (const spec of sampleSet.businesses) {
      if (current.some((r) => r.sample_key === spec.key && r.seed_version >= SAMPLE_VERSION)) continue;
      const { businessId, clients } = await buildBusiness(deps, owner, spec, now);
      await addMasterExpenses(deps.env, businessId, spec, now);
      await addMasterContracts(deps.env, owner, businessId, spec, clients, now);
      const fingerprint = await fingerprintOf(db, businessId);
      await transaction(db, [
        stmt(db, 'DELETE FROM demo_master_businesses WHERE sample_key = ?', spec.key),
        stmt(db, 'INSERT INTO demo_master_businesses (business_id, sample_key, seed_version, fingerprint) VALUES (?, ?, ?, ?)', businessId, spec.key, SAMPLE_VERSION, fingerprint),
      ]);
    }
    return { ready: true, loaded: true, businessIds: await listed() };
  } finally {
    await releaseBuildLock(db, holder);
  }
}
