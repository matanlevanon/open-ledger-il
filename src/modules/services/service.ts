import { type AuditActor, auditStatement } from '../../core/audit';
import { nowIso, stmt, transaction } from '../../core/db';
import { ValidationError } from '../../core/errors';
import { getService, listServices } from './repo';
import type { ServiceInput, ServicePatch } from './schemas';

export { listServices, getService } from './repo';
export type { ServiceRow } from './repo';

export async function createService(db: D1Database, actor: AuditActor, input: ServiceInput): Promise<number> {
  const results = await transaction(db, [
    stmt(
      db,
      `INSERT INTO items (name_en, name_he, description_en, description_he, unit_price_minor, currency,
         default_quantity_milli, unit, vat_treatment, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM items))`,
      input.nameEn,
      input.nameHe ?? null,
      input.descriptionEn ?? null,
      input.descriptionHe ?? null,
      input.unitPriceMinor,
      input.currency,
      input.defaultQuantityMilli,
      input.unit,
      input.vatTreatment,
      input.active,
    ),
    auditStatement(db, actor, 'service.create', 'service', null, { nameEn: input.nameEn }),
  ]);
  return results[0]!.meta.last_row_id;
}

export async function updateService(db: D1Database, actor: AuditActor, id: number, patch: ServicePatch): Promise<void> {
  const existing = await getService(db, id);
  await transaction(db, [
    stmt(
      db,
      `UPDATE items SET name_en = ?, name_he = ?, description_en = ?, description_he = ?, unit_price_minor = ?, currency = ?,
         default_quantity_milli = ?, unit = ?, vat_treatment = ?, active = ?, updated_at = ? WHERE id = ?`,
      patch.nameEn ?? existing.name_en,
      patch.nameHe !== undefined ? patch.nameHe : existing.name_he,
      patch.descriptionEn !== undefined ? patch.descriptionEn : existing.description_en,
      patch.descriptionHe !== undefined ? patch.descriptionHe : existing.description_he,
      patch.unitPriceMinor ?? existing.unit_price_minor,
      patch.currency ?? existing.currency,
      patch.defaultQuantityMilli ?? existing.default_quantity_milli,
      patch.unit ?? existing.unit,
      patch.vatTreatment ?? existing.vat_treatment,
      patch.active !== undefined ? (patch.active ? 1 : 0) : existing.active,
      nowIso(),
      id,
    ),
    auditStatement(db, actor, 'service.update', 'service', id, { fields: Object.keys(patch) }),
  ]);
}

export async function setActive(db: D1Database, actor: AuditActor, id: number, active: boolean): Promise<void> {
  await getService(db, id);
  await transaction(db, [
    stmt(db, 'UPDATE items SET active = ?, updated_at = ? WHERE id = ?', active, nowIso(), id),
    auditStatement(db, actor, active ? 'service.activate' : 'service.archive', 'service', id),
  ]);
}

/** Reassigns sort_order 0..n-1 in the order given. Every existing id must be present, once. */
export async function reorder(db: D1Database, actor: AuditActor, ids: number[]): Promise<void> {
  const existing = await listServices(db);
  const existingIds = new Set(existing.map((r) => r.id));
  if (ids.length !== existing.length || !ids.every((id) => existingIds.has(id)) || new Set(ids).size !== ids.length) {
    throw new ValidationError('Send every service id exactly once.');
  }
  await transaction(db, [
    ...ids.map((id, i) => stmt(db, 'UPDATE items SET sort_order = ?, updated_at = ? WHERE id = ?', i, nowIso(), id)),
    auditStatement(db, actor, 'service.reorder', 'service', null, { ids }),
  ]);
}
