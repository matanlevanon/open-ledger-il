import { type AuditActor, auditStatement } from '../../core/audit';
import { nowIso, stmt, transaction } from '../../core/db';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors';
import { getPaymentMethod, listPaymentMethods, type PaymentMethodRow } from './repo';
import { bankDetails, genericDetails, type PaymentMethodInput, type PaymentMethodPatch } from './schemas';

export { listPaymentMethods, getPaymentMethod, getPaymentMethods } from './repo';
export type { PaymentMethodRow } from './repo';

export async function createPaymentMethod(db: D1Database, actor: AuditActor, input: PaymentMethodInput): Promise<number> {
  const results = await transaction(db, [
    stmt(
      db,
      `INSERT INTO payment_methods (display_name, type, currency, details, active, sort_order)
       VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM payment_methods))`,
      input.displayName,
      input.type,
      input.currency ?? null,
      JSON.stringify(input.details),
      input.active,
    ),
    auditStatement(db, actor, 'payment_method.create', 'payment_method', null, { displayName: input.displayName, type: input.type }),
  ]);
  return results[0]!.meta.last_row_id;
}

function coerceDetails(type: string, details: unknown): string {
  const parsed = type === 'bank_transfer' ? bankDetails.parse(details ?? {}) : genericDetails.parse(details ?? {});
  return JSON.stringify(parsed);
}

export async function updatePaymentMethod(db: D1Database, actor: AuditActor, id: number, patch: PaymentMethodPatch): Promise<void> {
  const existing = await getPaymentMethod(db, id);
  const type = patch.type ?? existing.type;
  const details = patch.details !== undefined ? coerceDetails(type, patch.details) : patch.type !== undefined ? coerceDetails(type, JSON.parse(existing.details)) : existing.details;
  await transaction(db, [
    stmt(
      db,
      'UPDATE payment_methods SET display_name = ?, type = ?, currency = ?, details = ?, active = ?, updated_at = ? WHERE id = ?',
      patch.displayName ?? existing.display_name,
      type,
      patch.currency !== undefined ? patch.currency : existing.currency,
      details,
      patch.active !== undefined ? (patch.active ? 1 : 0) : existing.active,
      nowIso(),
      id,
    ),
    auditStatement(db, actor, 'payment_method.update', 'payment_method', id, { fields: Object.keys(patch) }),
  ]);
}

export async function setActive(db: D1Database, actor: AuditActor, id: number, active: boolean): Promise<void> {
  await getPaymentMethod(db, id);
  await transaction(db, [
    stmt(db, 'UPDATE payment_methods SET active = ?, updated_at = ? WHERE id = ?', active, nowIso(), id),
    auditStatement(db, actor, active ? 'payment_method.activate' : 'payment_method.deactivate', 'payment_method', id),
  ]);
}

/** Reassigns sort_order 0..n-1 in the order given. Every existing id must be present, once. */
export async function reorder(db: D1Database, actor: AuditActor, ids: number[]): Promise<void> {
  const existing = await listPaymentMethods(db);
  const existingIds = new Set(existing.map((r) => r.id));
  if (ids.length !== existing.length || !ids.every((id) => existingIds.has(id)) || new Set(ids).size !== ids.length) {
    throw new ValidationError('Send every payment method id exactly once.');
  }
  await transaction(db, [
    ...ids.map((id, i) => stmt(db, 'UPDATE payment_methods SET sort_order = ?, updated_at = ? WHERE id = ?', i, nowIso(), id)),
    auditStatement(db, actor, 'payment_method.reorder', 'payment_method', null, { ids }),
  ]);
}

/** Parses a document or client's `payment_method_ids` JSON column, dropping anything malformed. */
export function parseMethodIds(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : [];
  } catch {
    return [];
  }
}

/** Every id must exist; inactive is allowed (a document already using a method that was since deactivated stays valid). */
export async function assertMethodIdsExist(db: D1Database, ids: number[]): Promise<void> {
  for (const id of ids) {
    const exists = await getPaymentMethod(db, id).catch(() => null);
    if (!exists) throw new ConflictError('payment_method_not_found', `Payment method ${id} does not exist.`);
  }
}

/** Legacy bucket for `payments.method` (CHECK constraint, instruction 18ב(ד) check), derived from a chosen catalog entry. */
export function legacyMethodBucket(row: Pick<PaymentMethodRow, 'type'>): 'bank_transfer' | 'card' | 'cheque' | 'cash' | 'other' {
  if (row.type === 'bank_transfer' || row.type === 'card' || row.type === 'cheque' || row.type === 'cash') return row.type;
  return 'other';
}
