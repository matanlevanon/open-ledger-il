import { run } from '../../../src/core/db';
import { db } from '../../helpers';

export interface ClientOverrides {
  email?: string | null;
  phone?: string | null;
  /** R19: a Hebrew-only client has no nameEn; pass '' to test the name-fallback in emails, WhatsApp and consent. */
  nameEn?: string;
  nameHe?: string | null;
}

export async function insertSendingClient(overrides: ClientOverrides = {}): Promise<number> {
  const { lastRowId } = await run(
    db(),
    `INSERT INTO clients (name_en, name_he, country, currency, email, phone) VALUES (?, ?, 'IL', 'ILS', ?, ?)`,
    overrides.nameEn ?? 'Test Client Ltd',
    overrides.nameHe ?? null,
    overrides.email === undefined ? 'client@example.com' : overrides.email,
    overrides.phone === undefined ? '+972501234567' : overrides.phone,
  );
  return lastRowId;
}

export interface PaymentRequestOverrides {
  dueDate?: string | null;
  totalMinor?: number;
  date?: string;
}

/** A draft against the seeded 'PR' series (migrations/0003_seed.sql), so document_types.kind = 'demand' matches. */
export async function insertPaymentRequest(clientId: number | null, overrides: PaymentRequestOverrides = {}): Promise<number> {
  const total = overrides.totalMinor ?? 100000;
  const { lastRowId } = await run(
    db(),
    `INSERT INTO documents (type, series_id, client_id, date, due_date, currency, subtotal_minor, total_minor)
     VALUES ('PR', 'PR', ?, ?, ?, 'ILS', ?, ?)`,
    clientId,
    overrides.date ?? '2026-10-01',
    overrides.dueDate ?? null,
    total,
    total,
  );
  await run(
    db(),
    `INSERT INTO document_lines (document_id, position, description_en, unit_price_minor, line_total_minor) VALUES (?, 1, 'Retainer', ?, ?)`,
    lastRowId,
    total,
    total,
  );
  return lastRowId;
}
