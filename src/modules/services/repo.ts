import { all, first } from '../../core/db';
import { NotFoundError } from '../../core/errors';
import type { ServiceUnit, VatTreatment } from './schemas';

/**
 * A row in `items` (0001_core.sql), extended by migrations/1702_services.sql. The table name
 * stays `items` (document_lines.item_id already references it); "services" is the product name
 * for this screen, per docs/ui-direction.md and the R17 task 5 spec.
 */
export interface ServiceRow {
  id: number;
  name_en: string;
  name_he: string | null;
  description_en: string | null;
  description_he: string | null;
  unit_price_minor: number;
  currency: string;
  default_quantity_milli: number;
  unit: ServiceUnit;
  vat_treatment: VatTreatment;
  active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export async function listServices(db: D1Database, activeOnly = false): Promise<ServiceRow[]> {
  const where = activeOnly ? 'WHERE active = 1' : '';
  return all<ServiceRow>(db, `SELECT * FROM items ${where} ORDER BY sort_order, id`);
}

export async function getService(db: D1Database, id: number): Promise<ServiceRow> {
  const row = await first<ServiceRow>(db, 'SELECT * FROM items WHERE id = ?', id);
  if (!row) throw new NotFoundError('Service', id);
  return row;
}
