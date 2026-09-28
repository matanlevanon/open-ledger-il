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

export async function listPaymentMethods(db: D1Database, activeOnly = false): Promise<PaymentMethodRow[]> {
  const where = activeOnly ? 'WHERE active = 1' : '';
  return all<PaymentMethodRow>(db, `SELECT * FROM payment_methods ${where} ORDER BY sort_order, id`);
}

export async function getPaymentMethod(db: D1Database, id: number): Promise<PaymentMethodRow> {
  const row = await first<PaymentMethodRow>(db, 'SELECT * FROM payment_methods WHERE id = ?', id);
  if (!row) throw new NotFoundError('Payment method', id);
  return row;
}

/** Rows for a set of ids, in no particular order, silently dropping ids that no longer exist. */
export async function getPaymentMethods(db: D1Database, ids: number[]): Promise<PaymentMethodRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return all<PaymentMethodRow>(db, `SELECT * FROM payment_methods WHERE id IN (${placeholders})`, ...ids);
}
