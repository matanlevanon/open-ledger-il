import { beforeEach, describe, expect, it, vi } from 'vitest';
import { first, run } from '../../../src/core/db';
import { DRIVE_DAILY_CRON } from '../../../src/modules/expenses';
import { connectionView } from '../../../src/modules/financy/connection';
import { decryptToken, encryptToken, importTokenKey } from '../../../src/modules/ita/crypto';
import { CREDS, FakeFinancy, TEST_KEY, call, connect, env, fenv, financyApp, put, resetFinancy, wholeDatabase } from './helpers';

/** R40 tasks 1, 2 and 3b: the stored connection, the Financy client, picking accounts, and the sync. */

describe('R40: connect to Financy', () => {
  beforeEach(resetFinancy);

  it('tests the details, saves them, lists the bank and card accounts with nothing ticked, and pulls nothing yet', async () => {
    const fake = new FakeFinancy();
    const { app } = financyApp(fake);
    const res = await call(app, '', put(CREDS));
    expect(res.status).toBe(200);
    expect(res.body.connection).toMatchObject({ connected: true, status: 'connected', clientId: CREDS.clientId, secretLast4: 'abcd', userId: CREDS.userId, accountIds: [], needsAccounts: true });
    expect(res.body.accounts.map((a: any) => [a.id, a.type, a.last4, a.blocked, a.picked])).toEqual([
      ['acc-checking', 'CHECKING', '8901', false, false],
      ['acc-fx', 'CHECKING', '0011', false, false],
      ['acc-card', 'CARD', '9012', false, false],
      ['acc-card-max', 'CARD', '3344', false, false],
      ['acc-personal', 'CARD', '0005', false, false],
      ['acc-card-blocked', 'CARD', '1111', true, false],
    ]);
    expect(res.body.accounts.find((a: any) => a.id === 'acc-fx').currencies).toEqual(['USD', 'EUR']);
    expect(JSON.stringify(res.body)).not.toContain(CREDS.clientSecret);
    expect(await first(env.DB, 'SELECT 1 FROM bank_transactions')).toBeNull();
    expect(fake.calls).not.toContain('/v2/data/transactions');
    const audit = await first<{ details: string }>(env.DB, "SELECT details FROM audit_log WHERE action = 'financy.connect' ORDER BY id DESC");
    expect(audit?.details).toContain(CREDS.clientId);
    expect(audit?.details).not.toContain(CREDS.clientSecret);
  });

  it('with no account picked, Sync now does nothing and asks Financy nothing', async () => {
    const fake = new FakeFinancy();
    const { app } = financyApp(fake);
    await call(app, '', put(CREDS));
    fake.calls = [];
    const res = await call(app, '/sync', { method: 'POST' });
    expect(res.body.sync).toEqual({ accounts: 0, transactions: 0, new: 0, matched: 0 });
    expect(fake.calls).toEqual([]);
  });

  it('picking the business accounts pulls 90 days of those accounts only', async () => {
    const fake = new FakeFinancy();
    const res = await connect(financyApp(fake).app);
    expect(res.status).toBe(200);
    expect(res.body.connection).toMatchObject({ accountIds: ['acc-checking', 'acc-card'], needsAccounts: false });
    expect(res.body.sync).toEqual({ accounts: 2, transactions: 60, new: 60, matched: 0 });
    const accounts = await env.DB.prepare('SELECT financy_id FROM bank_accounts ORDER BY financy_id').all<{ financy_id: string }>();
    expect(accounts.results.map((a) => a.financy_id)).toEqual(['acc-card', 'acc-checking']);
    const others = await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM bank_transactions WHERE financy_id LIKE 'px-%' OR financy_id LIKE 'loan-%'");
    expect(others?.n).toBe(0);
  });

  it('never offers or stores savings, loans or securities, and refuses an id Financy did not offer', async () => {
    const { app } = financyApp(new FakeFinancy());
    await call(app, '', put(CREDS));
    for (const id of ['acc-savings', 'acc-loan', 'acc-securities', 'no-such-account']) {
      const res = await call(app, '/picked-accounts', put({ accountIds: [id] }));
      expect(res.status).toBe(400);
    }
    expect(await first(env.DB, 'SELECT 1 FROM bank_accounts')).toBeNull();
  });

  it('unticking an account with stored rows asks first, then deletes them', async () => {
    const { app } = financyApp(new FakeFinancy());
    await connect(app);
    const asked = await call(app, '/picked-accounts', put({ accountIds: ['acc-checking'] }));
    expect(asked.status).toBe(409);
    expect(asked.body.error.code).toBe('financy_unpick');
    expect(asked.body.error.message).toBe('Unticking this account deletes its 36 stored transactions. Confirm to go on.');
    expect((await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM bank_transactions WHERE account_financy_id = 'acc-card'"))?.n).toBe(36);

    const done = await call(app, '/picked-accounts', put({ accountIds: ['acc-checking'], confirm: true }));
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ accountIds: ['acc-checking'], removed: ['acc-card'], deletedTransactions: 36 });
    expect(await first(env.DB, "SELECT 1 FROM bank_transactions WHERE account_financy_id = 'acc-card'")).toBeNull();
    expect(await first(env.DB, "SELECT 1 FROM bank_accounts WHERE financy_id = 'acc-card'")).toBeNull();
    expect((await call(app, '/available-accounts')).body.accounts.filter((a: any) => a.picked).map((a: any) => a.id)).toEqual(['acc-checking']);
  });

  it('a plan without API access saves nothing and says so', async () => {
    const fake = new FakeFinancy();
    fake.mode = 'plan';
    const res = await call(financyApp(fake).app, '', put(CREDS));
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: 'financy_plan', message: 'Your Financy plan has no API access. Starter or higher is needed.' });
    expect(await first(env.DB, 'SELECT 1 FROM financy_connection')).toBeNull();
  });

  it('wrong details save nothing and say where to copy them from', async () => {
    const res = await call(financyApp(new FakeFinancy()).app, '', put({ ...CREDS, clientSecret: 'wrong-secret' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('financy_auth');
    expect(res.body.error.message).toBe('Financy refused these details. Copy them again from Financy > Settings > API.');
    expect(res.body.error.message).not.toContain('wrong-secret');
    expect(await first(env.DB, 'SELECT 1 FROM financy_connection')).toBeNull();
    expect(await first(env.DB, 'SELECT 1 FROM bank_accounts')).toBeNull();
  });

  it('keeps the secret encrypted: the plain secret is in no column of any table', async () => {
    await connect(financyApp(new FakeFinancy()).app);
    expect(await wholeDatabase()).not.toContain(CREDS.clientSecret);
    const row = await first<{ client_secret_enc: string }>(env.DB, 'SELECT client_secret_enc FROM financy_connection WHERE business_id = 1');
    expect(row!.client_secret_enc).toMatch(/^v1\.[^.]+\.[^.]+$/);
  });

  it('the additional data stops the secret decrypting as an ITA token, or as another business', async () => {
    await call(financyApp(new FakeFinancy()).app, '', put(CREDS));
    const row = await first<{ client_secret_enc: string }>(env.DB, 'SELECT client_secret_enc FROM financy_connection WHERE business_id = 1');
    const key = await importTokenKey(TEST_KEY);
    expect(await decryptToken(key, row!.client_secret_enc, 'financy:1')).toBe(CREDS.clientSecret);
    await expect(decryptToken(key, row!.client_secret_enc, 'production')).rejects.toThrow();
    await expect(decryptToken(key, row!.client_secret_enc, 'sandbox')).rejects.toThrow();
    await expect(decryptToken(key, row!.client_secret_enc, 'financy:2')).rejects.toThrow();
    const itaToken = await encryptToken(key, 'ita-token', 'production');
    await expect(decryptToken(key, itaToken, 'financy:1')).rejects.toThrow();
  });

  it('stores no owner name, national id, full or masked account number, or long additional info', async () => {
    await connect(financyApp(new FakeFinancy()).app);
    const all = await wholeDatabase();
    for (const value of ['Test Owner Fullname', '000000018', '678901', '12-345-678901', '532610xxxxxx9012', '532610', 'x'.repeat(201)]) expect(all).not.toContain(value);
  });
});

describe('R40: sync reads the live shapes', () => {
  beforeEach(resetFinancy);

  it('one balance per currency, the entry without the credit limit first, and a card due day in each form', async () => {
    const { app } = financyApp(new FakeFinancy());
    await connect(app, ['acc-checking', 'acc-fx', 'acc-card', 'acc-card-max', 'acc-card-blocked', 'acc-personal']);
    const rows = await env.DB.prepare('SELECT financy_id, masked_number, balance_minor, balance_type, available_minor, credit_limit_minor, card_due_date, balances_json, blocked FROM bank_accounts ORDER BY financy_id').all<any>();
    const by = Object.fromEntries(rows.results.map((r) => [r.financy_id, r]));
    expect(by['acc-checking']).toMatchObject({ masked_number: '8901', balance_minor: 1410025, balance_type: 'interimAvailable', available_minor: 1410025, card_due_date: null, blocked: 0 });
    expect(JSON.parse(by['acc-fx'].balances_json)).toEqual([
      { currency: 'USD', balanceMinor: 120050, balanceType: 'closingBooked' },
      { currency: 'EUR', balanceMinor: 30000, balanceType: 'closingBooked' },
    ]);
    expect(by['acc-card']).toMatchObject({ masked_number: '9012', balance_minor: -231040, balance_type: 'interimBooked', credit_limit_minor: 2000000, card_due_date: '2' });
    expect(by['acc-card-max'].card_due_date).toBe('10');
    expect(by['acc-card-blocked']).toMatchObject({ card_due_date: '15', blocked: 1 });
    expect(by['acc-personal'].card_due_date).toBe('20');
  });

  it('a bank row with no transactionDate takes its bookingDate, and the merchant falls back to the description', async () => {
    await connect(financyApp(new FakeFinancy()).app);
    const fee = await first<{ kind: string; booked_on: string; merchant: string | null; description: string; category_main: string }>(
      env.DB,
      "SELECT kind, booked_on, merchant, description, category_main FROM bank_transactions WHERE financy_id = 'tx-003'",
    );
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - 3);
    expect(fee).toEqual({ kind: 'BANK', booked_on: day.toISOString().slice(0, 10), merchant: null, description: 'Bank fee 3', category_main: 'FINANCE' });
    const card = await first<{ kind: string; amount_minor: number; merchant: string }>(env.DB, "SELECT kind, amount_minor, merchant FROM bank_transactions WHERE financy_id = 'tx-001'");
    expect(card).toEqual({ kind: 'CARD', amount_minor: -1150, merchant: 'Merchant 1' });
  });

  it('reads every page, and skips rows Financy marks as duplicates', async () => {
    const fake = new FakeFinancy({ pageSize: 25 });
    fake.transactions[0]!.isDuplicate = true;
    await connect(financyApp(fake).app);
    // The checking account holds 24 rows (one page), the card 36 (two pages).
    expect(fake.calls.filter((p) => p === '/v2/data/transactions')).toHaveLength(3);
    expect((await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM bank_transactions'))?.n).toBe(59);
  });

  it('a 401 gets a new token and the call once more', async () => {
    const fake = new FakeFinancy();
    const { app } = financyApp(fake);
    await connect(app);
    const before = fake.tokensIssued;
    fake.expireNextCall = true;
    const res = await call(app, '/sync', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(fake.tokensIssued).toBe(before + 1);
  });

  it('a 429 stops the sync with a plain message and marks the connection', async () => {
    const fake = new FakeFinancy();
    const { app } = financyApp(fake);
    await connect(app);
    fake.mode = 'busy';
    const res = await call(app, '/sync', { method: 'POST' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('financy_busy');
    expect((await call(app, '')).body.connection).toMatchObject({ status: 'error', lastError: 'Financy asked the Ledger to slow down. Try again in a few minutes.' });
  });

  it('a sync keeps the status of rows already matched, ignored or added', async () => {
    const fake = new FakeFinancy();
    const { app } = financyApp(fake);
    await connect(app);
    await run(env.DB, "UPDATE bank_transactions SET match_status = 'ignored' WHERE financy_id = 'tx-002'");
    fake.transactions.find((t) => t.id === 'tx-002')!.merchantName = 'Renamed merchant';
    await call(app, '/sync', { method: 'POST' });
    const row = await first<{ match_status: string; merchant: string }>(env.DB, "SELECT match_status, merchant FROM bank_transactions WHERE financy_id = 'tx-002'");
    expect(row).toEqual({ match_status: 'ignored', merchant: 'Renamed merchant' });
  });

  it('the daily cron syncs connected businesses, and a failure marks the connection without throwing', async () => {
    const fake = new FakeFinancy();
    const { app, module } = financyApp(fake);
    await connect(app);
    fake.mode = 'plan';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(module.scheduled!({ cron: DRIVE_DAILY_CRON, scheduledTime: Date.now(), noRetry() {} } as ScheduledController, fenv, {} as ExecutionContext)).resolves.toBeUndefined();
    expect(log.mock.calls.find((c) => c[0] === 'financy.sync_daily')?.[1]).toEqual({ synced: 0, failed: 1 });
    log.mockRestore();
    err.mockRestore();
    const row = await first<{ status: string; last_error: string }>(env.DB, 'SELECT status, last_error FROM financy_connection WHERE business_id = 1');
    expect(row).toEqual({ status: 'error', last_error: 'Your Financy plan has no API access. Starter or higher is needed.' });
  });

  it('Disconnect drops the secret, Delete bank data removes what was pulled', async () => {
    const { app } = financyApp(new FakeFinancy());
    await connect(app);
    const deleted = await call(app, '/data', { method: 'DELETE' });
    expect(deleted.body.deleted).toEqual({ accounts: 2, transactions: 60 });
    expect(await first(env.DB, 'SELECT 1 FROM bank_transactions')).toBeNull();
    expect(await first(env.DB, 'SELECT 1 FROM bank_accounts')).toBeNull();

    const off = await call(app, '', { method: 'DELETE' });
    expect(off.body.connection.connected).toBe(false);
    const row = await first<{ status: string; client_secret_enc: string | null }>(env.DB, 'SELECT status, client_secret_enc FROM financy_connection WHERE business_id = 1');
    expect(row).toEqual({ status: 'disconnected', client_secret_enc: null });
    expect((await call(app, '/sync', { method: 'POST' })).status).toBe(409);
  });

  it('is for the owner only', async () => {
    const { app } = financyApp(new FakeFinancy());
    expect((await call(app, '', {}, { DEV_AUTH_EMAIL: 'cpa@example.com' })).status).toBe(403);
    expect((await call(app, '/available-accounts', {}, { DEV_AUTH_EMAIL: 'cpa@example.com' })).status).toBe(403);
    expect(connectionView(null)).toMatchObject({ connected: false, status: null, accountIds: [], needsAccounts: false });
  });
});
