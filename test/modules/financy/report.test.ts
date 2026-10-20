import { beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { createApp } from '../../../src/index';
import { env, fenv, resetFinancy } from './helpers';

/** R40 task 7: the Bank vs books report. */

const app = createApp();
let seq = 0;
async function tx(amount: number, date: string, category: string | null, status = 'unmatched', kind = 'BANK') {
  seq += 1;
  await run(
    env.DB,
    "INSERT INTO bank_transactions (business_id, financy_id, account_financy_id, kind, booked_on, amount_minor, currency, category_main, match_status) VALUES (1, ?, 'acc', ?, ?, ?, 'ILS', ?, ?)",
    `r-${seq}`,
    kind,
    date,
    amount,
    category,
    status,
  );
}

describe('R40: Bank vs books', () => {
  beforeEach(async () => {
    await resetFinancy();
    await run(env.DB, 'UPDATE expenses SET duplicate_of_id = NULL, file_id = NULL');
    await run(env.DB, 'DELETE FROM expenses');
    await tx(-10000, '2026-09-03', 'Software');
    await tx(-5000, '2026-09-04', 'Software');
    await tx(-2000, '2026-09-05', null, 'ignored');
    await tx(30000, '2026-09-06', 'Income');
    await tx(500, '2026-09-07', 'Refund', 'unmatched', 'CARD');
    await tx(-700, '2026-09-08', 'Fees', 'matched');
    await run(env.DB, "INSERT INTO expenses (status, document_date, currency, amount_minor, amount_ils_minor, business_id) VALUES ('new', '2026-09-10', 'ILS', 15700, 15700, 1)");
    await run(env.DB, "INSERT INTO expenses (status, document_date, currency, amount_minor, amount_ils_minor, business_id) VALUES ('not_expense', '2026-09-11', 'ILS', 999, 999, 1)");
  });

  it('sums the bank by category, the books, and the two gaps per month', async () => {
    const res = await app.request('/api/reports/r/bank-vs-books?from=2026-09-01&to=2026-09-30', {}, fenv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { cells: { month: string; line: string; count: number; ils: number } }[] };
    expect(body.rows.map((r) => [r.cells.line, r.cells.count, r.cells.ils])).toEqual([
      ['Bank money out: Software', 2, 15000],
      ['Bank money out: No category', 1, 2000],
      ['Bank money out: Fees', 1, 700],
      ['Money out recorded as expenses', 1, 15700],
      ['Bank money in', 2, 30500],
      ['Money in recorded as receipts', 0, 0],
      ['Card and bank charges with no expense', 2, 15000],
      ['Deposits with no receipt', 1, 30000],
    ]);
    expect(body.rows.every((r) => r.cells.month === '2026-09')).toBe(true);
  });

  it('exports CSV like the other reports', async () => {
    const res = await app.request('/api/reports/r/bank-vs-books/csv?from=2026-09-01&to=2026-09-30', {}, fenv);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.split(/\r?\n/)[0]).toContain('Month');
    expect(text).toContain('Card and bank charges with no expense');
    expect(text).toContain('150.00');
  });
});
