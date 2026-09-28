import { run } from '../../../src/core/db';
import { db } from '../../helpers';

export interface DocOverrides {
  type?: string;
  currency?: string;
  subtotalMinor?: number;
  vatAmountMinor?: number;
  clientId?: number | null;
  allocationNumber?: string | null;
}

export async function insertClient(overrides: { foreignResident?: boolean; vatNumber?: string | null } = {}): Promise<number> {
  const { lastRowId } = await run(
    db(),
    `INSERT INTO clients (name_en, country, foreign_resident, currency, vat_number) VALUES (?, ?, ?, ?, ?)`,
    'Test Client Ltd',
    overrides.foreignResident ? 'GB' : 'IL',
    overrides.foreignResident ? 1 : 0,
    'ILS',
    overrides.vatNumber ?? null,
  );
  return lastRowId;
}

export async function insertDocument(seriesId: string, overrides: DocOverrides = {}): Promise<number> {
  const subtotal = overrides.subtotalMinor ?? 100000;
  const vat = overrides.vatAmountMinor ?? 0;
  const { lastRowId } = await run(
    db(),
    `INSERT INTO documents (type, series_id, client_id, date, currency, subtotal_minor, vat_amount_minor, total_minor, allocation_number)
     VALUES (?, ?, ?, '2026-10-05', ?, ?, ?, ?, ?)`,
    overrides.type ?? seriesId,
    seriesId,
    overrides.clientId ?? null,
    overrides.currency ?? 'ILS',
    subtotal,
    vat,
    subtotal + vat,
    overrides.allocationNumber ?? null,
  );
  await run(
    db(),
    `INSERT INTO document_lines (document_id, position, description_en, unit_price_minor, line_total_minor) VALUES (?, 1, 'Line', ?, ?)`,
    lastRowId,
    subtotal,
    subtotal,
  );
  return lastRowId;
}
