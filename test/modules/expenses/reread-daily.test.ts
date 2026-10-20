import { beforeEach, describe, expect, it, vi } from 'vitest';
import { systemActorFor } from '../../../src/core/audit';
import { run } from '../../../src/core/db';
import { ProviderBusyError } from '../../../src/modules/ai';
import { DRIVE_DAILY_CRON, createExpensesModule } from '../../../src/modules/expenses';
import type { Extractor, ExtractInput } from '../../../src/modules/expenses/extractor';
import { FakeDriveSource } from '../../../src/modules/expenses/fakes';
import { retryUnreadExpenses } from '../../../src/modules/expenses/service';
import type { ExpenseRow, ExtractedExpense } from '../../../src/modules/expenses/types';
import { FakeFxHistory, FxRates } from '../../../src/modules/fx';
import { buildApp, bytesFrom, call, env, uploadForm } from './helpers';

/** R39 task 4: the daily cron reads unread expenses again. */

const fields = (documentNumber: string): ExtractedExpense => ({
  supplierName: 'Nightly Ltd',
  supplierId: '515000002',
  documentNumber,
  date: '2026-10-01',
  currency: 'ILS',
  amount: '59.00',
  vatAmount: '9.00',
  documentType: null,
});

/** Answers per filename. A filename with no answer fails with `error`. */
class NightlyExtractor implements Extractor {
  answers: Record<string, ExtractedExpense> = {};
  error: Error = new Error('The answer does not fit the expense fields.');
  calls: string[] = [];
  configured = true;
  available(): boolean {
    return this.configured;
  }
  async extract(input: ExtractInput): Promise<ExtractedExpense> {
    this.calls.push(input.filename);
    const answer = this.answers[input.filename];
    if (!answer) throw this.error;
    return answer;
  }
}

const NOW = new Date('2026-10-20T03:00:00Z');
const actor = systemActorFor(1);

describe('R39: the daily retry of unread expenses', () => {
  let extractor: NightlyExtractor;
  let app: ReturnType<typeof buildApp>;
  const deps = () => ({ extractor, fx: new FxRates(env.DB, new FakeFxHistory({})) });

  /** An unread expense from an upload, created at `createdAt`. */
  async function unread(name: string, createdAt = '2026-10-19T09:00:00.000Z'): Promise<ExpenseRow> {
    const res = await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom(`${name}-${crypto.randomUUID()}`), name, 'application/pdf') });
    const { expense } = (await res.json()) as { expense: ExpenseRow };
    await run(env.DB, 'UPDATE expenses SET created_at = ? WHERE id = ?', createdAt, expense.id);
    return expense;
  }

  const row = (id: number) => env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first<ExpenseRow>();

  beforeEach(async () => {
    await run(env.DB, 'UPDATE expenses SET duplicate_of_id = NULL, file_id = NULL');
    await run(env.DB, 'UPDATE expense_files SET expense_id = NULL');
    await run(env.DB, 'DELETE FROM expenses');
    await run(env.DB, 'DELETE FROM expense_files');
    extractor = new NightlyExtractor();
    app = buildApp({ extractor });
  });

  it('picks only New, failed, under 4 attempts, with a file, from the last 30 days', async () => {
    const due = await unread('due.pdf');
    const tired = await unread('tired.pdf');
    await run(env.DB, 'UPDATE expenses SET read_attempts = 4 WHERE id = ?', tired.id);
    await unread('old.pdf', '2026-09-19T09:00:00.000Z');
    const filed = await unread('filed.pdf');
    await run(env.DB, "UPDATE expenses SET status = 'filed' WHERE id = ?", filed.id);
    const typed = await unread('typed.pdf');
    await run(env.DB, "UPDATE expenses SET read_status = 'manual' WHERE id = ?", typed.id);
    await run(env.DB, "INSERT INTO expenses (status, document_date, business_id, read_status, read_attempts, created_at) VALUES ('new', '2026-10-19', 1, 'failed', 1, '2026-10-19T09:00:00.000Z')");
    extractor.calls = [];
    extractor.answers = { 'due.pdf': fields('N-1') };

    const batch = await retryUnreadExpenses(env, deps(), actor, NOW);
    expect(batch).toEqual({ tried: 1, read: 1, failed: 0, stoppedBusy: false });
    expect(extractor.calls).toEqual(['due.pdf']);
    expect(await row(due.id)).toMatchObject({ read_status: 'read', read_attempts: 2, read_error: null, amount_minor: 5900 });
    expect((await row(tired.id))!.read_attempts).toBe(4);
  });

  it('reads at most 10 a run, oldest first', async () => {
    for (let i = 0; i < 12; i += 1) await unread(`f${String(i).padStart(2, '0')}.pdf`, `2026-10-${String(i + 1).padStart(2, '0')}T09:00:00.000Z`);
    extractor.calls = [];
    const batch = await retryUnreadExpenses(env, deps(), actor, NOW);
    expect(batch).toMatchObject({ tried: 10, read: 0, failed: 10 });
    expect(extractor.calls).toEqual(['f00.pdf', 'f01.pdf', 'f02.pdf', 'f03.pdf', 'f04.pdf', 'f05.pdf', 'f06.pdf', 'f07.pdf', 'f08.pdf', 'f09.pdf']);
  });

  it('stops the batch at the first busy provider', async () => {
    const a = await unread('a.pdf', '2026-10-10T09:00:00.000Z');
    const b = await unread('b.pdf', '2026-10-11T09:00:00.000Z');
    extractor.error = new ProviderBusyError('Gemini', 503, 'High demand.');
    extractor.calls = [];

    const batch = await retryUnreadExpenses(env, deps(), actor, NOW);
    expect(batch).toEqual({ tried: 1, read: 0, failed: 1, stoppedBusy: true });
    expect(await row(a.id)).toMatchObject({ read_attempts: 2, read_error: 'Gemini is busy right now (HTTP 503). High demand.' });
    expect((await row(b.id))!.read_attempts).toBe(1);
  });

  it('runs the duplicate check, as upload does', async () => {
    extractor.answers = { 'first.pdf': fields('DUP-1') };
    const first = ((await (await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('first one'), 'first.pdf', 'application/pdf') })).json()) as { expense: ExpenseRow }).expense;
    const second = await unread('second.pdf');
    extractor.answers['second.pdf'] = fields('DUP-1');

    await retryUnreadExpenses(env, deps(), actor, NOW);
    expect(await row(second.id)).toMatchObject({ status: 'duplicate', duplicate_of_id: first.id, read_status: 'read' });
  });

  it('tries nothing when no reader is configured', async () => {
    await unread('nokey.pdf');
    extractor.configured = false;
    extractor.calls = [];
    expect(await retryUnreadExpenses(env, deps(), actor, NOW)).toEqual({ tried: 0, read: 0, failed: 0, stoppedBusy: false });
    expect(extractor.calls).toEqual([]);
  });

  it('runs on the daily cron and logs one line', async () => {
    const waiting = await unread('cron.pdf', new Date(Date.now() - 86_400_000).toISOString());
    extractor.answers = { 'cron.pdf': fields('CRON-1') };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const module = createExpensesModule(() => ({ drive: new FakeDriveSource(), ...deps() }));
    await module.scheduled!({ cron: DRIVE_DAILY_CRON, scheduledTime: Date.now(), noRetry() {} } as ScheduledController, env, {} as ExecutionContext);
    expect((await row(waiting.id))!.read_status).toBe('read');
    const lines = log.mock.calls.filter((c) => c[0] === 'expense.reread_daily');
    log.mockRestore();
    expect(lines).toHaveLength(1);
    expect(lines[0]![1]).toMatchObject({ tried: 1, read: 1, stillFailed: 0 });
  });
});
