import { beforeEach, describe, expect, it } from 'vitest';
import { first, run } from '../../../src/core/db';
import type { FinancyTransaction } from '../../../src/modules/financy/client';
import { CARD_COMPANIES, companiesOf, isCardPayment } from '../../../src/modules/financy/flows';
import { FakeFxHistory, FxRates } from '../../../src/modules/fx';
import { createApp } from '../../../src/index';
import { businessesApp, finalPaymentRequest } from '../businesses/helpers';
import { BUSINESS_ACCOUNTS, FakeFinancy, call, connect, env, fenv, financyApp, put, resetFinancy } from './helpers';

/** R42 tasks 2, 3 and 5: the Financy Dashboard numbers, money not counted twice, Count this, and matching by hand. */

const today = new Date().toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);
const daysAgo = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
/** USD 3.7 and EUR 4.0 for the last ten days. */
function fakeFx() {
  const days = Array.from({ length: 10 }, (_, i) => daysAgo(i));
  return new FxRates(env.DB, new FakeFxHistory({ USD: Object.fromEntries(days.map((d) => [d, '3.7'])), EUR: Object.fromEntries(days.map((d) => [d, '4.0'])) }));
}
const minor = (major: number) => Math.round(major * 100);
const bankRow = (id: string, amount: number, extra: Partial<FinancyTransaction> = {}, accountId = 'acc-checking'): FinancyTransaction => ({
  id,
  accountId,
  amount: { chargedAmount: { amount, currency: 'ILS' } },
  description: { description: id },
  date: { transactionDate: null, bookingDate: today, valueDate: today },
  ...extra,
});

/** The current month's income and expenses from the fake rows of the picked accounts, leaving out `skip`. */
function expectedMonth(fake: FakeFinancy, picked: string[], skip: string[]) {
  let income = 0;
  let expenses = 0;
  for (const t of fake.transactions) {
    const date = t.date?.transactionDate ?? t.date?.bookingDate ?? '';
    if (!picked.includes(t.accountId ?? '') || skip.includes(t.id ?? '') || !date.startsWith(thisMonth)) continue;
    const m = minor(Number(t.amount?.chargedAmount?.amount));
    if (m > 0) income += m;
    else expenses += -m;
  }
  return { income, expenses, net: income - expenses };
}

const dashboard = async (app: ReturnType<typeof financyApp>['app'], months = 3) => (await call(app, `/dashboard?months=${months}`)).body.dashboard;

describe('R42: the Financy Dashboard numbers', () => {
  beforeEach(async () => {
    await resetFinancy();
    await run(env.DB, 'UPDATE expenses SET duplicate_of_id = NULL, file_id = NULL');
    await run(env.DB, 'DELETE FROM expenses');
  });

  it('is null until an account is picked, and the main dashboard says when the tab shows', async () => {
    const { app } = financyApp(new FakeFinancy(), fakeFx());
    const main = async () => ((await (await createApp().request('/api/dashboard', {}, fenv)).json()) as { financyTab: boolean; bank?: unknown }).financyTab;
    expect(await main()).toBe(false);
    await call(app, '', put({ clientId: 'fake-client-id', clientSecret: 'fake-secret-0123456789-abcd', userId: 'fake-user-1' }));
    expect(await dashboard(app)).toBeNull();
    expect(await main()).toBe(false);
    await call(app, '/picked-accounts', put({ accountIds: BUSINESS_ACCOUNTS }));
    expect(await main()).toBe(true);
    const body = (await (await createApp().request('/api/dashboard', {}, fenv)).json()) as Record<string, unknown>;
    expect(body.bank).toBeUndefined();
  });

  it('liquidity: checking cash in two more currencies at today\'s rate, minus the current card charges', async () => {
    const { app } = financyApp(new FakeFinancy(), fakeFx());
    await connect(app, ['acc-checking', 'acc-fx', 'acc-card', 'acc-card-max']);
    const d = await dashboard(app);
    const cash = 1410025 + 444185 + 120000;
    expect(d.liquidity).toEqual({ cash, cardsCurrent: 231040 + 50000, net: cash - 281040 });
    expect(d.accounts.checking.totals).toEqual({ ILS: 1410025, USD: 120050, EUR: 30000 });
    const fx = d.accounts.checking.rows.find((r: any) => r.id === 'acc-fx');
    expect(fx.balances).toEqual([
      { currency: 'USD', balanceMinor: 120050, ilsMinor: 444185 },
      { currency: 'EUR', balanceMinor: 30000, ilsMinor: 120000 },
    ]);
    expect(d.accounts.cards.rows.find((r: any) => r.id === 'acc-card')).toMatchObject({ provider: 'isracard', last4: '9012', currentMinor: 231040, statementMinor: 198000, dueDay: '2', blocked: false });
    expect(d.accounts.cards.totalCurrent).toBe(281040);
    expect(d.unconverted).toEqual([]);
  });

  it('the month against the month before, the cash flow months, and a month with no rows', async () => {
    const fake = new FakeFinancy();
    const { app } = financyApp(fake, fakeFx());
    await connect(app);
    const d = await dashboard(app);
    expect(d.month.month).toBe(thisMonth);
    expect(d.month.current).toEqual(expectedMonth(fake, BUSINESS_ACCOUNTS, []));
    expect(d.cashflow).toHaveLength(3);
    expect(d.cashflow[2]).toMatchObject({ month: thisMonth, income: d.month.current.income, expenses: d.month.current.expenses });
    const prev = d.month.previous;
    const pct = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 100));
    expect(d.month.changePct).toEqual({ income: pct(d.month.current.income, prev.income), expenses: pct(d.month.current.expenses, prev.expenses), net: pct(d.month.current.net, prev.net) });
    const six = await dashboard(app, 6);
    expect(six.cashflow).toHaveLength(6);
    expect(six.cashflow[0]).toMatchObject({ income: 0, expenses: 0 });
  });

  it('categories: the top 6, and the rest as Other', async () => {
    const codes = ['SHOPPING', 'LEISURE', 'TRANSPORT', 'FINANCE', 'INSURANCE', 'HEALTH_&_BEAUTY', 'OTHER', 'NATIONAL_INSURANCE'];
    const fake = new FakeFinancy({ transactions: codes.map((c, i) => bankRow(`c-${i}`, -(100 * (i + 1)), { category: { main: c } }, 'acc-card')) });
    const { app } = financyApp(fake, fakeFx());
    await connect(app);
    const { expenses } = (await dashboard(app)).categories;
    expect(expenses.total).toBe(minor(3600));
    expect(expenses.rows).toHaveLength(7);
    expect(expenses.rows[0]).toMatchObject({ key: 'NATIONAL_INSURANCE', label: 'National Insurance', amount: 80000, shareBp: 2222 });
    expect(expenses.rows[6]).toMatchObject({ key: 'OTHER_REST', label: 'Other', amount: 30000 });
  });

  it('card bills paid from checking and transfers between own accounts are not counted, and summed apart', async () => {
    const fake = new FakeFinancy();
    fake.transactions.push(
      bankRow('cp-isracard', -300, { description: { description: 'חיוב ישראכרט' } }),
      bankRow('cp-max', -200, { description: { description: 'MAX IT FINANCE payment' } }),
      bankRow('cp-cal', -100, { merchantName: 'כאל' }),
      bankRow('cp-maxim', -50, { description: { description: 'Maxim restaurant' } }),
      bankRow('ot-out', -1000),
      bankRow('ot-in', 1000, {}, 'acc-fx'),
    );
    const picked = ['acc-checking', 'acc-fx', 'acc-card', 'acc-card-max'];
    const { app } = financyApp(fake, fakeFx());
    await connect(app, picked);
    const flows = Object.fromEntries(
      (await env.DB.prepare("SELECT financy_id, flow FROM bank_transactions WHERE financy_id LIKE 'cp-%' OR financy_id LIKE 'ot-%'").all<{ financy_id: string; flow: string }>()).results.map((r) => [r.financy_id, r.flow]),
    );
    expect(flows).toEqual({ 'cp-isracard': 'card_payment', 'cp-max': 'card_payment', 'cp-cal': 'normal', 'cp-maxim': 'normal', 'ot-out': 'own_transfer', 'ot-in': 'own_transfer' });
    const d = await dashboard(app);
    expect(d.excluded).toEqual({ sum: minor(1500), ownTransfer: minor(1000), cardPayment: minor(500) });
    expect(d.month.current).toEqual(expectedMonth(fake, picked, ['cp-isracard', 'cp-max', 'ot-out', 'ot-in']));
    const statuses = Object.fromEntries(d.recent.filter((r: any) => r.description?.startsWith('cp-') || ['ot-out', 'ot-in', 'חיוב ישראכרט'].includes(r.description)).map((r: any) => [r.description, r.status]));
    expect(statuses['חיוב ישראכרט']).toBe('not_counted');
  });

  it('knows each card company in English and Hebrew, Latin names as whole words', () => {
    const all = companiesOf(CARD_COMPANIES.flatMap((c) => c.providers));
    expect(all.map((c) => c.key)).toEqual(['isracard', 'max', 'cal', 'amex', 'diners']);
    const row = (text: string) => ({ kind: 'BANK', amount_minor: -100, description: text, merchant: null, category_main: null, category_sub: null });
    for (const text of ['Isracard', 'ישראכרט', 'MAX', 'מקס', 'לאומי קארד', 'Cal', 'כאל', 'ויזה כאל', 'American Express', 'אמריקן אקספרס', 'אמקס', 'Diners', 'דיינרס']) {
      expect(isCardPayment(row(`חיוב ${text} 10/26`), all), text).toBe(true);
    }
    for (const text of ['Maxim', 'Calcalist', 'Supermax']) expect(isCardPayment(row(text), all), text).toBe(false);
    expect(isCardPayment({ ...row('Isracard'), amount_minor: 100 }, all)).toBe(false);
    expect(isCardPayment({ ...row('Isracard'), kind: 'CARD' }, all)).toBe(false);
    expect(isCardPayment({ ...row('anything'), category_main: 'CREDIT_CARD_PAYMENT' }, all)).toBe(true);
    expect(isCardPayment(row('ישראכרט'), companiesOf(['max']))).toBe(false);
  });

  it('Count this counts a wrong mark again, and a later sync keeps it', async () => {
    const fake = new FakeFinancy();
    fake.transactions.push(bankRow('cp-wrong', -400, { description: { description: 'Isracard refund desk' } }));
    const { app } = financyApp(fake, fakeFx());
    await connect(app);
    const id = (await first<{ id: number }>(env.DB, "SELECT id FROM bank_transactions WHERE financy_id = 'cp-wrong'"))!.id;
    expect((await first<{ flow: string }>(env.DB, 'SELECT flow FROM bank_transactions WHERE id = ?', id))?.flow).toBe('card_payment');
    const res = await call(app, `/transactions/${id}/count`, { method: 'POST' });
    expect(res.body.transaction).toMatchObject({ flow: 'normal', status: 'to_match' });
    await call(app, '/sync', { method: 'POST' });
    expect(await first(env.DB, 'SELECT flow, flow_locked FROM bank_transactions WHERE id = ?', id)).toEqual({ flow: 'normal', flow_locked: 1 });
    expect(await first(env.DB, "SELECT 1 FROM audit_log WHERE action = 'financy.count' AND entity_id = ?", String(id))).not.toBeNull();
  });

  it('the Bank activity list filters by flow', async () => {
    const fake = new FakeFinancy();
    fake.transactions.push(bankRow('cp-flow', -300, { description: { description: 'ישראכרט' } }));
    const { app } = financyApp(fake, fakeFx());
    await connect(app);
    const notCounted = (await call(app, '/transactions?flow=card_payment')).body.transactions;
    expect(notCounted.map((t: any) => t.description)).toEqual(['ישראכרט']);
    expect((await call(app, '/transactions?flow=nonsense')).status).toBe(400);
  });
});

describe('R42: matching by hand', () => {
  beforeEach(async () => {
    await resetFinancy();
    await run(env.DB, 'UPDATE expenses SET duplicate_of_id = NULL, file_id = NULL');
    await run(env.DB, 'DELETE FROM expenses');
  });

  it('money out: candidates closest amount first, match, a second row cannot take it, and unmatch', async () => {
    const { app } = financyApp(new FakeFinancy(), fakeFx());
    await connect(app);
    const near = (await run(env.DB, "INSERT INTO expenses (status, document_date, currency, amount_minor, business_id, read_status) VALUES ('new', ?, 'ILS', 1150, 1, 'manual')", daysAgo(1))).lastRowId;
    const far = (await run(env.DB, "INSERT INTO expenses (status, document_date, currency, amount_minor, business_id, read_status) VALUES ('new', ?, 'ILS', 9000, 1, 'manual')", daysAgo(3))).lastRowId;
    await run(env.DB, "INSERT INTO expenses (status, document_date, currency, amount_minor, business_id, read_status) VALUES ('new', ?, 'ILS', 1150, 1, 'manual')", daysAgo(30));
    const id = (await first<{ id: number }>(env.DB, "SELECT id FROM bank_transactions WHERE financy_id = 'tx-001'"))!.id;
    const other = (await first<{ id: number }>(env.DB, "SELECT id FROM bank_transactions WHERE financy_id = 'tx-002'"))!.id;

    const candidates = (await call(app, `/transactions/${id}/candidates`)).body.candidates;
    expect(candidates.map((c: any) => c.id)).toEqual([near, far]);

    const matched = await call(app, `/transactions/${id}/match`, put({ expenseId: near }));
    expect(matched.body.transaction).toMatchObject({ matchStatus: 'matched', expenseId: near, status: 'matched' });
    expect((await call(app, `/transactions/${other}/match`, put({ expenseId: near }))).body.error.code).toBe('expense_already_matched');

    const undone = await call(app, `/transactions/${id}/match`, { method: 'DELETE' });
    expect(undone.body.transaction).toMatchObject({ matchStatus: 'unmatched', expenseId: null, status: 'to_match' });
    const actions = (await env.DB.prepare("SELECT action FROM audit_log WHERE entity = 'bank_transaction' AND entity_id = ? ORDER BY id").bind(String(id)).all<{ action: string }>()).results.map((r) => r.action);
    expect(actions.slice(-2)).toEqual(['financy.match', 'financy.unmatch']);
  });

  it('money in: an open payment request becomes the suggestion, and nothing is recorded', async () => {
    const { app } = financyApp(new FakeFinancy(), fakeFx());
    await connect(app);
    const pr = await finalPaymentRequest(businessesApp(), 1, 100500);
    const id = (await first<{ id: number }>(env.DB, "SELECT id FROM bank_transactions WHERE financy_id = 'tx-005'"))!.id;
    await run(env.DB, 'UPDATE bank_transactions SET matched_document_id = NULL WHERE id = ?', id);
    const candidates = (await call(app, `/transactions/${id}/candidates`)).body.candidates;
    expect(candidates[0]).toMatchObject({ kind: 'document', id: pr.id });
    const res = await call(app, `/transactions/${id}/match`, put({ documentId: pr.id }));
    expect(res.body.transaction).toMatchObject({ status: 'suggested', matchStatus: 'unmatched', suggestion: { documentId: pr.id } });
    expect((await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM payments WHERE document_id = ?', pr.id))?.n).toBe(0);
  });

  it('another business\'s row is not found, and a row that is not counted cannot be matched', async () => {
    const { app } = financyApp(new FakeFinancy(), fakeFx());
    await connect(app);
    const foreign = (await run(env.DB, "INSERT INTO bank_transactions (business_id, financy_id, kind, booked_on, amount_minor, currency) VALUES (2, 'b2-row', 'BANK', ?, -500, 'ILS')", today)).lastRowId;
    const expense = (await run(env.DB, "INSERT INTO expenses (status, document_date, currency, amount_minor, business_id, read_status) VALUES ('new', ?, 'ILS', 500, 1, 'manual')", today)).lastRowId;
    expect((await call(app, `/transactions/${foreign}/match`, put({ expenseId: expense }))).status).toBe(404);
    expect((await call(app, `/transactions/${foreign}/count`, { method: 'POST' })).status).toBe(404);
    const own = (await first<{ id: number }>(env.DB, "SELECT id FROM bank_transactions WHERE financy_id = 'tx-003'"))!.id;
    await run(env.DB, "UPDATE bank_transactions SET flow = 'card_payment' WHERE id = ?", own);
    expect((await call(app, `/transactions/${own}/match`, put({ expenseId: expense }))).body.error.code).toBe('bank_not_matchable');
    await run(env.DB, 'DELETE FROM bank_transactions WHERE id = ?', foreign);
  });
});
