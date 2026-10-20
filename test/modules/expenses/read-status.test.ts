import { beforeEach, describe, expect, it } from 'vitest';
import migration from '../../../migrations/3900_expense_read.sql?raw';
import { run } from '../../../src/core/db';
import { FakeExtractor } from '../../../src/modules/expenses/fakes';
import type { ExpenseRow } from '../../../src/modules/expenses/types';
import { buildApp, bytesFrom, call, env, uploadForm } from './helpers';

/** R39 task 2: every expense says whether the reader read it, and why not. */

const fields = { supplierName: 'Read Co', supplierId: null, documentNumber: 'R-1', date: '2026-10-01', currency: 'ILS', amount: '118.00', vatAmount: '18.00', documentType: null };

async function upload(app: ReturnType<typeof buildApp>, name: string, text = name): Promise<{ expense: ExpenseRow; read: boolean }> {
  const res = await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom(text), name, 'application/pdf') });
  return (await res.json()) as { expense: ExpenseRow; read: boolean };
}

describe('R39: read status on new expenses', () => {
  beforeEach(async () => {
    await run(env.DB, 'UPDATE expenses SET duplicate_of_id = NULL, file_id = NULL');
    await run(env.DB, 'UPDATE expense_files SET expense_id = NULL');
    await run(env.DB, 'DELETE FROM expenses');
    await run(env.DB, 'DELETE FROM expense_files');
  });

  it('a file the reader read is read, once, with the time', async () => {
    const app = buildApp({ extractor: new FakeExtractor({ 'ok.pdf': fields }) });
    const { expense, read } = await upload(app, 'ok.pdf');
    expect(read).toBe(true);
    expect(expense.read_status).toBe('read');
    expect(expense.read_attempts).toBe(1);
    expect(expense.read_error).toBeNull();
    expect(expense.read_at).not.toBeNull();
  });

  it('a file the reader could not read is failed, once, with the reason', async () => {
    const app = buildApp({ extractor: { extract: async () => { throw new Error('Gemini is busy right now (HTTP 503). High demand.'); } } });
    const { expense, read } = await upload(app, 'busy.pdf');
    expect(read).toBe(false);
    expect(expense.read_status).toBe('failed');
    expect(expense.read_attempts).toBe(1);
    expect(expense.read_error).toBe('Gemini is busy right now (HTTP 503). High demand.');
    expect(expense.read_at).toBeNull();
    expect(expense.notes).toBe('Not read automatically: Gemini is busy right now (HTTP 503). High demand.');
  });

  it('the reason is kept to 500 characters, the note to 200', async () => {
    const long = 'x'.repeat(900);
    const app = buildApp({ extractor: { extract: async () => { throw new Error(long); } } });
    const { expense } = await upload(app, 'long.pdf');
    expect(expense.read_error).toHaveLength(500);
    expect(expense.notes).toBe(`Not read automatically: ${'x'.repeat(200)}`);
  });

  it('the migration marks older unread expenses failed and takes the reason from the note', async () => {
    const backfill = migration.slice(migration.indexOf('UPDATE expenses'), migration.indexOf(';', migration.indexOf('UPDATE expenses')) + 1);
    const { lastRowId: unread } = await run(
      env.DB,
      "INSERT INTO expenses (status, document_date, notes, business_id) VALUES ('new', '2026-10-01', 'From: a@b.c | Not read automatically: Gemini extraction failed: 503 busy', 1)",
    );
    const { lastRowId: plain } = await run(env.DB, "INSERT INTO expenses (status, document_date, notes, business_id) VALUES ('new', '2026-10-01', 'Paid by card', 1)");
    await run(env.DB, backfill);
    const rows = await env.DB.prepare('SELECT id, read_status, read_attempts, read_error FROM expenses WHERE id IN (?, ?) ORDER BY id').bind(unread, plain).all();
    expect(rows.results).toEqual([
      { id: unread, read_status: 'failed', read_attempts: 1, read_error: 'Gemini extraction failed: 503 busy' },
      { id: plain, read_status: null, read_attempts: 0, read_error: null },
    ]);
  });
});
