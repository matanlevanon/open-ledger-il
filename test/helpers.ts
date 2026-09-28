import { env } from 'cloudflare:workers';
import type { AuditActor } from '../src/core/audit';
import { first, run } from '../src/core/db';

export const db = () => env.DB;

export const OWNER_ACTOR: AuditActor = {
  userId: null,
  email: 'owner@example.com',
  role: 'owner',
  ip: '127.0.0.1',
  userAgent: 'vitest',
};

/** A fresh open series with a unique id and doc type, so tests never share numbers. */
export async function makeSeries(start = 1): Promise<string> {
  const id = `T${crypto.randomUUID().slice(0, 8)}`;
  await run(
    db(),
    'INSERT INTO series (id, doc_type, name_en, start_number, next_number) VALUES (?, ?, ?, ?, ?)',
    id,
    id,
    `Test ${id}`,
    start,
    start,
  );
  return id;
}

export interface DraftInput {
  seriesId: string;
  currency?: string;
  totalMinor?: number;
  lines?: { description: string; quantityMilli?: number; unitPriceMinor: number }[];
  payments?: { method?: string; paidOn?: string; amountMinor: number; currency?: string }[];
}

/** Inserts a draft document with lines and payments. Returns its id. */
export async function makeDraft(input: DraftInput): Promise<number> {
  const lines = input.lines ?? [{ description: 'Consulting', unitPriceMinor: 100000 }];
  const total = input.totalMinor ?? lines.reduce((s, l) => s + (l.unitPriceMinor * (l.quantityMilli ?? 1000)) / 1000, 0);
  const { lastRowId } = await run(
    db(),
    `INSERT INTO documents (type, series_id, date, currency, subtotal_minor, total_minor)
     VALUES (?, ?, '2026-10-01', ?, ?, ?)`,
    input.seriesId,
    input.seriesId,
    input.currency ?? 'ILS',
    total,
    total,
  );
  let position = 1;
  for (const l of lines) {
    const qty = l.quantityMilli ?? 1000;
    await run(
      db(),
      `INSERT INTO document_lines (document_id, position, description_en, quantity_milli, unit_price_minor, line_total_minor)
       VALUES (?, ?, ?, ?, ?, ?)`,
      lastRowId,
      position++,
      l.description,
      qty,
      l.unitPriceMinor,
      (l.unitPriceMinor * qty) / 1000,
    );
  }
  for (const p of input.payments ?? []) {
    await run(
      db(),
      `INSERT INTO payments (document_id, method, paid_on, amount_minor, currency) VALUES (?, ?, ?, ?, ?)`,
      lastRowId,
      p.method ?? 'bank_transfer',
      p.paidOn ?? '2026-10-01',
      p.amountMinor,
      p.currency ?? 'ILS',
    );
  }
  return lastRowId;
}

export async function docRow(id: number) {
  return first<Record<string, unknown>>(db(), 'SELECT * FROM documents WHERE id = ?', id);
}

/** Runs a raw statement and returns the error message, or null when it succeeded. */
export async function sqlError(sql: string, ...params: (string | number | null)[]): Promise<string | null> {
  try {
    await env.DB.prepare(sql).bind(...params).run();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
