import { all, first } from '../../core/db';
import { NotFoundError } from '../../core/errors';
import type { PaymentMethodType } from './schemas';

export interface PaymentMethodRow {
  id: number;
  display_name: string;
  type: PaymentMethodType;
  currency: string | null;
  details: string;
  active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** R24: every read is scoped to one business. */
export async function listPaymentMethods(db: D1Database, businessId: number, activeOnly = false): Promise<PaymentMethodRow[]> {
  const where = activeOnly ? 'AND active = 1' : '';
  return all<PaymentMethodRow>(db, `SELECT * FROM payment_methods WHERE business_id = ? ${where} ORDER BY sort_order, id`, businessId);
}

export async function getPaymentMethod(db: D1Database, id: number, businessId: number): Promise<PaymentMethodRow> {
  const row = await first<PaymentMethodRow>(db, 'SELECT * FROM payment_methods WHERE id = ? AND business_id = ?', id, businessId);
  if (!row) throw new NotFoundError('Payment method', id);
  return row;
}

/** Rows for a set of ids, in no particular order, silently dropping ids that no longer exist. */
export async function getPaymentMethods(db: D1Database, ids: number[], businessId: number): Promise<PaymentMethodRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return all<PaymentMethodRow>(db, `SELECT * FROM payment_methods WHERE business_id = ? AND id IN (${placeholders})`, businessId, ...ids);
}
