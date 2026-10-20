import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { first, run } from '../../../src/core/db';
import { createApp } from '../../../src/index';
import { FakeFinancy, TODAY, call, connect, env, fenv, financyApp, resetFinancy } from './helpers';

/** R40 task 6: Bank activity. List, Add as expense, Not a business expense, and who may act. */

const ACCOUNTANT = 'acct-r40@example.com';

describe('R40: Bank activity', () => {
  let app: ReturnType<typeof financyApp>['app'];

  beforeAll(async () => {
    await run(env.DB, "INSERT OR IGNORE INTO users (email, role, access_ends_on) VALUES (?, 'accountant', '2099-12-31')", ACCOUNTANT);
    await run(
      env.DB,
      "INSERT OR IGNORE INTO user_features (user_id, feature, enabled) SELECT id, 'expenses', 1 FROM users WHERE email = ?",
      ACCOUNTANT,
    );
  });

  beforeEach(async () => {
    await resetFinancy();
    await run(env.DB, 'UPDATE expenses SET duplicate_of_id = NULL, file_id = NULL');
    await run(env.DB, 'DELETE FROM expenses');
    app = financyApp(new FakeFinancy()).app;
    await connect(app);
  });

  const list = async (query = '', email?: string) => call(app, `/transactions${query}`, {}, email ? { DEV_AUTH_EMAIL: email } : {});
  const rowOf = async (financyId: string) => (await first<{ id: number }>(env.DB, 'SELECT id FROM bank_transactions WHERE financy_id = ?', financyId))!.id;

  it('lists with filters: month, account, money in or out, status', async () => {
    const all = (await list()).body;
    expect(all.canEdit).toBe(true);
    expect(all.accounts).toHaveLength(2);
    expect(all.transactions.length).toBeGreaterThan(0);
    expect(all.transactions).toHaveLength(60);
    const month = (await list(`?month=${TODAY.slice(0, 7)}`)).body.transactions;
    expect(month.length).toBeGreaterThan(0);
    expect(month.every((t: any) => t.date.startsWith(TODAY.slice(0, 7)))).toBe(true);

    const out = (await list('?direction=out')).body.transactions;
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((t: any) => t.amountMinor < 0)).toBe(true);
    const ins = (await list('?direction=in')).body.transactions;
    expect(ins.every((t: any) => t.amountMinor > 0)).toBe(true);
    const card = (await list('?account=acc-card')).body.transactions;
    expect(card.every((t: any) => t.kind === 'CARD' && t.accountLast4 === '9012')).toBe(true);

    const id = await rowOf('tx-001');
    await call(app, `/transactions/${id}/ignore`, { method: 'POST' });
    const ignored = (await list('?status=ignored')).body.transactions;
    expect(ignored.map((t: any) => t.id)).toEqual([id]);
    expect((await list('?month=2026-13')).status).toBe(400);
  });

  it('Add as expense: a new expense typed by hand, the merchant as supplier, a note, no file', async () => {
    const id = await rowOf('tx-001');
    const res = await call(app, `/transactions/${id}/add-expense`, { method: 'POST' });
    expect(res.status).toBe(201);
    expect(res.body.transaction).toMatchObject({ matchStatus: 'added', expenseId: res.body.expenseId });
    const expense = await first<any>(
      env.DB,
      'SELECT e.status, e.read_status, e.file_id, e.amount_minor, e.currency, e.notes, e.document_date, s.name AS supplier FROM expenses e JOIN suppliers s ON s.id = e.supplier_id WHERE e.id = ?',
      res.body.expenseId,
    );
    expect(expense).toMatchObject({ status: 'new', read_status: 'manual', file_id: null, amount_minor: 1150, currency: 'ILS', notes: 'From bank: Purchase 1', supplier: 'Merchant 1' });
    expect((await call(app, `/transactions/${id}/add-expense`, { method: 'POST' })).status).toBe(409);
  });

  it('Add as expense refuses money in', async () => {
    const id = await rowOf('tx-005');
    const res = await call(app, `/transactions/${id}/add-expense`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('bank_not_addable');
  });

  it('Not a business expense sets the row aside, once', async () => {
    const id = await rowOf('tx-002');
    const res = await call(app, `/transactions/${id}/ignore`, { method: 'POST' });
    expect(res.body.transaction.matchStatus).toBe('ignored');
    expect((await call(app, `/transactions/${id}/ignore`, { method: 'POST' })).status).toBe(409);
    const audit = await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'financy.ignore' AND entity_id = ?", String(id));
    expect(audit?.n).toBe(1);
  });

  it('a deleted expense sets its bank row back to unmatched', async () => {
    const id = await rowOf('tx-004');
    const { expenseId } = (await call(app, `/transactions/${id}/add-expense`, { method: 'POST' })).body;
    const res = await createApp().request(`/api/expenses/${expenseId}`, { method: 'DELETE' }, fenv);
    expect(res.status).toBe(200);
    const row = await first<{ match_status: string; matched_expense_id: number | null }>(env.DB, 'SELECT match_status, matched_expense_id FROM bank_transactions WHERE id = ?', id);
    expect(row).toEqual({ match_status: 'unmatched', matched_expense_id: null });
  });

  it('the accountant reads and cannot act', async () => {
    const read = await list('', ACCOUNTANT);
    expect(read.status).toBe(200);
    expect(read.body.canEdit).toBe(false);
    const id = await rowOf('tx-001');
    expect((await call(app, `/transactions/${id}/add-expense`, { method: 'POST' }, { DEV_AUTH_EMAIL: ACCOUNTANT })).status).toBe(403);
    expect((await call(app, `/transactions/${id}/ignore`, { method: 'POST' }, { DEV_AUTH_EMAIL: ACCOUNTANT })).status).toBe(403);
  });

  it('says plainly when Financy is not connected', async () => {
    await resetFinancy();
    const res = await list();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('financy_not_connected');
  });
});
