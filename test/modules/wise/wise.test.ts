import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { first, run } from '../../../src/core/db';
import type { Env } from '../../../src/env';
import { createApp } from '../../../src/index';
import { financyTabAvailable } from '../../../src/modules/financy/connection';
import { matchBankTransactions } from '../../../src/modules/financy/matching';
import { decryptToken, importTokenKey } from '../../../src/modules/ita/crypto';
import { createWiseModule } from '../../../src/modules/wise';
import { WISE_MESSAGES } from '../../../src/modules/wise/client';
import { verifyWiseSignature } from '../../../src/modules/wise/hook';
import { wiseTransactions } from '../../../src/modules/wise/map';
import { syncAllWiseDaily } from '../../../src/modules/wise/sync';
import { businessesApp, finalPaymentRequest } from '../businesses/helpers';
import { TEST_KEY, wholeDatabase } from '../financy/helpers';

/** R49: the Wise Business connection, its sync into the bank tables, and the webhook. */

const wenv = { ...(env as unknown as Env), ITA_TOKEN_KEY: TEST_KEY } as Env;
const TOKEN = 'wise-test-token-1234567890-wxyz';
const BUSINESS = { id: 7001, type: 'BUSINESS', businessName: 'Sample Studio LLC' };
const PERSONAL = { id: 7000, type: 'PERSONAL', fullName: 'Sample Person' };
const TODAY = new Date().toISOString().slice(0, 10);

function daysAgo(n: number): string {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

const USD_ROWS = [
  {
    type: 'CREDIT',
    date: daysAgo(2),
    amount: { value: 2993.89, currency: 'USD' },
    totalFees: { value: 6.11, currency: 'USD' },
    details: { type: 'DEPOSIT', description: 'Received money from ACME INC with reference INV 40021', senderName: 'ACME INC', paymentReference: 'INV 40021' },
    referenceNumber: 'TRANSFER-900001',
  },
  {
    type: 'DEBIT',
    date: daysAgo(3),
    amount: { value: -49.0, currency: 'USD' },
    totalFees: { value: 0, currency: 'USD' },
    details: { type: 'CARD', description: 'Card transaction of 49.00 USD issued by Figma', merchant: { name: 'Figma' }, category: 'Software' },
    referenceNumber: 'CARD-900002',
  },
  {
    type: 'DEBIT',
    date: daysAgo(4),
    amount: { value: -500, currency: 'USD' },
    totalFees: { value: 2.1, currency: 'USD' },
    details: { type: 'CONVERSION', description: 'Converted 500.00 USD to 460.00 EUR' },
    referenceNumber: 'BALANCE-900003',
  },
];
const EUR_ROWS = [
  {
    type: 'CREDIT',
    date: daysAgo(4),
    amount: { value: 460, currency: 'EUR' },
    totalFees: { value: 0, currency: 'EUR' },
    details: { type: 'CONVERSION', description: 'Converted 500.00 USD to 460.00 EUR' },
    referenceNumber: 'BALANCE-900003',
  },
];

class FakeWise {
  calls: string[] = [];
  profiles: unknown[] = [PERSONAL, BUSINESS];
  /** Answer 404 on the dated paths, as an API that only knows the numbered ones. */
  datedPaths = true;
  subscriptions: { id: string; trigger_on: string; delivery: { url: string; version: string } }[] = [];
  allowSubscriptions = true;
  statementStatus = 200;
  usdRows: unknown[] = USD_ROWS;

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const auth = new Headers(init?.headers).get('Authorization');
    this.calls.push(`${method} ${url.pathname}`);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (auth !== `Bearer ${TOKEN}`) return json({ error: 'invalid_token' }, 401);
    const dated = url.pathname.startsWith('/2026Q4/');
    if (dated && !this.datedPaths) return json({ error: 'not_found' }, 404);
    const path = url.pathname.replace(/^\/(2026Q4|v\d)/, '');
    if (path === '/profiles') return json(this.profiles);
    if (/^\/profiles\/\d+\/balances$/.test(path)) {
      return json([
        { id: 501, currency: 'USD', type: 'STANDARD', amount: { value: 12444.78, currency: 'USD' } },
        { id: 502, currency: 'EUR', type: 'STANDARD', amount: { value: 460, currency: 'EUR' } },
      ]);
    }
    const statement = /^\/profiles\/\d+\/balance-statements\/(\d+)\/statement\.json$/.exec(path);
    if (statement) {
      if (this.statementStatus !== 200) return json({ error: 'forbidden' }, this.statementStatus);
      return json({ transactions: statement[1] === '501' ? this.usdRows : EUR_ROWS });
    }
    if (/^\/profiles\/\d+\/subscriptions$/.test(path)) {
      if (!this.allowSubscriptions) return json({ error: 'forbidden' }, 403);
      if (method === 'GET') return json(this.subscriptions);
      const body = JSON.parse(String(init?.body)) as { trigger_on: string; delivery: { url: string; version: string } };
      const made = { id: `sub-${this.subscriptions.length + 1}`, trigger_on: body.trigger_on, delivery: body.delivery };
      this.subscriptions.push(made);
      return json(made);
    }
    const one = /^\/profiles\/\d+\/subscriptions\/(.+)$/.exec(path);
    if (one && method === 'DELETE') {
      this.subscriptions = this.subscriptions.filter((s) => s.id !== one[1]);
      return new Response(null, { status: 204 });
    }
    return json({ error: 'not_found' }, 404);
  };
}

let keys: CryptoKeyPair;
let publicPem = '';

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const spki = new Uint8Array((await crypto.subtle.exportKey('spki', keys.publicKey)) as ArrayBuffer);
  publicPem = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...spki))}\n-----END PUBLIC KEY-----`;
});

async function sign(body: string): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(body)));
  return btoa(String.fromCharCode(...sig));
}

function wiseApp(fake: FakeWise) {
  const deps = () => ({ fetch: fake.fetch, publicKeyPem: publicPem });
  return createApp({ modules: [createWiseModule(deps)], wise: deps });
}

async function call(app: ReturnType<typeof createApp>, path: string, init: RequestInit = {}) {
  const res = await app.request(`/api/wise${path}`, init, wenv);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
}

const put = (body: unknown): RequestInit => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function hook(app: ReturnType<typeof createApp>, hookId: string, body: string, headers: Record<string, string>) {
  const res = await app.request(`/v1/hooks/wise/${hookId}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }, wenv);
  return { status: res.status, body: (await res.json()) as any };
}

const event = (type: string, profileId = BUSINESS.id, name = 'balances#update') =>
  JSON.stringify({
    schema_version: '4.0.0',
    subscription_id: 'sub-1',
    event_type: name,
    sent_at: new Date().toISOString(),
    data: { resource: { type: 'balance-account', id: 501, profile_id: profileId }, amount: 2993.89, balance_id: 501, currency: 'USD', transaction_type: type, occurred_at: new Date().toISOString() },
  });

async function hookIdOf(): Promise<string> {
  return (await first<{ hook_id: string }>(env.DB, 'SELECT hook_id FROM wise_connection WHERE business_id = 1'))!.hook_id;
}

beforeEach(async () => {
  await run(env.DB, 'DELETE FROM bank_transactions');
  await run(env.DB, 'DELETE FROM bank_accounts');
  await run(env.DB, 'DELETE FROM wise_connection');
  await run(env.DB, 'DELETE FROM financy_connection');
});

describe('R49: connect Wise', () => {
  it('saves the token encrypted, reads only the Business profile, makes the webhook and pulls 90 days', async () => {
    const fake = new FakeWise();
    const res = await call(wiseApp(fake), '', put({ token: TOKEN }));
    expect(res.status).toBe(200);
    expect(res.body.connection).toMatchObject({ connected: true, status: 'connected', tokenLast4: 'wxyz', profileName: 'Sample Studio LLC' });
    expect(res.body.connection.webhook.state).toBe('auto');
    expect(res.body.sync).toEqual({ accounts: 2, transactions: 4, new: 4, matched: 0 });
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);

    const row = await first<{ token_enc: string; profile_id: number; hook_id: string; subscription_id: string }>(env.DB, 'SELECT * FROM wise_connection WHERE business_id = 1');
    expect(row!.profile_id).toBe(BUSINESS.id);
    expect(row!.subscription_id).toBe('sub-1');
    expect(await decryptToken(await importTokenKey(TEST_KEY), row!.token_enc, 'wise:1')).toBe(TOKEN);
    expect(await wholeDatabase()).not.toContain(TOKEN);
    expect(fake.subscriptions[0]).toMatchObject({ trigger_on: 'balances#update', delivery: { version: '4.0.0' } });
    expect(fake.subscriptions[0]!.delivery.url).toBe(res.body.connection.webhook.url);
    expect(res.body.connection.webhook.url).toMatch(new RegExp(`/v1/hooks/wise/${row!.hook_id}$`));
    // The personal profile is never asked about.
    expect(fake.calls.some((c) => c.includes(`/profiles/${PERSONAL.id}/`))).toBe(false);

    const accounts = await env.DB.prepare('SELECT financy_id, account_type, provider_id, currency, balance_minor FROM bank_accounts ORDER BY financy_id').all();
    expect(accounts.results).toEqual([
      { financy_id: 'wise:501', account_type: 'CHECKING', provider_id: 'wise', currency: 'USD', balance_minor: 1244478 },
      { financy_id: 'wise:502', account_type: 'CHECKING', provider_id: 'wise', currency: 'EUR', balance_minor: 46000 },
    ]);
    const audit = await first<{ details: string }>(env.DB, "SELECT details FROM audit_log WHERE action = 'wise.connect' ORDER BY id DESC");
    expect(audit?.details).toContain('wxyz');
    expect(audit?.details).not.toContain(TOKEN);
  });

  it('stores money in net with the sent amount beside it, money out negative, and a conversion as a move between own balances', async () => {
    await call(wiseApp(new FakeWise()), '', put({ token: TOKEN }));
    const rows = await env.DB.prepare('SELECT financy_id, kind, amount_minor, currency, original_amount_minor, original_currency, merchant, flow FROM bank_transactions ORDER BY financy_id').all();
    expect(rows.results).toEqual([
      { financy_id: 'wise:501:BALANCE-900003', kind: 'BANK', amount_minor: -50000, currency: 'USD', original_amount_minor: null, original_currency: null, merchant: null, flow: 'own_transfer' },
      { financy_id: 'wise:501:CARD-900002', kind: 'BANK', amount_minor: -4900, currency: 'USD', original_amount_minor: null, original_currency: null, merchant: 'Figma', flow: 'normal' },
      { financy_id: 'wise:501:TRANSFER-900001', kind: 'BANK', amount_minor: 299389, currency: 'USD', original_amount_minor: 300000, original_currency: 'USD', merchant: 'ACME INC', flow: 'normal' },
      { financy_id: 'wise:502:BALANCE-900003', kind: 'BANK', amount_minor: 46000, currency: 'EUR', original_amount_minor: null, original_currency: null, merchant: null, flow: 'own_transfer' },
    ]);
  });

  it('a second sync adds nothing new and keeps a row a person already handled', async () => {
    const app = wiseApp(new FakeWise());
    await call(app, '', put({ token: TOKEN }));
    await run(env.DB, "UPDATE bank_transactions SET match_status = 'ignored' WHERE financy_id = 'wise:501:CARD-900002'");
    const res = await call(app, '/sync', { method: 'POST' });
    expect(res.body.sync).toEqual({ accounts: 2, transactions: 4, new: 0, matched: 0 });
    expect((await first<{ match_status: string }>(env.DB, "SELECT match_status FROM bank_transactions WHERE financy_id = 'wise:501:CARD-900002'"))!.match_status).toBe('ignored');
  });

  it('falls back to the numbered paths when Wise does not know the dated ones', async () => {
    const fake = new FakeWise();
    fake.datedPaths = false;
    const res = await call(wiseApp(fake), '', put({ token: TOKEN }));
    expect(res.status).toBe(200);
    expect(res.body.sync.transactions).toBe(4);
    expect(fake.calls).toContain('GET /v2/profiles');
    expect(fake.calls).toContain(`GET /v4/profiles/${BUSINESS.id}/balances`);
    expect(fake.calls).toContain(`GET /v1/profiles/${BUSINESS.id}/balance-statements/501/statement.json`);
  });

  it('when Wise refuses the webhook call, the connection still works and the panel gives the address to add by hand', async () => {
    const fake = new FakeWise();
    fake.allowSubscriptions = false;
    const res = await call(wiseApp(fake), '', put({ token: TOKEN }));
    expect(res.status).toBe(200);
    expect(res.body.connection).toMatchObject({ connected: true, webhook: { state: 'manual', event: 'balances#update' } });
    expect(res.body.connection.webhook.url).toContain('/v1/hooks/wise/');
    expect(res.body.sync.transactions).toBe(4);
  });

  it('refuses a wrong token and saves nothing', async () => {
    const res = await call(wiseApp(new FakeWise()), '', put({ token: 'not-the-token-12345' }));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'wise_auth', message: WISE_MESSAGES.wise_auth });
    expect(await first(env.DB, 'SELECT 1 FROM wise_connection')).toBeNull();
  });

  it('refuses a token with no Business profile, and asks to pick when there are two', async () => {
    const fake = new FakeWise();
    fake.profiles = [PERSONAL];
    const none = await call(wiseApp(fake), '', put({ token: TOKEN }));
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe('wise_no_business');

    fake.profiles = [PERSONAL, BUSINESS, { id: 7002, type: 'BUSINESS', businessName: 'Second LLC' }];
    const two = await call(wiseApp(fake), '', put({ token: TOKEN }));
    expect(two.status).toBe(409);
    expect(two.body.error).toMatchObject({
      code: 'wise_pick_profile',
      details: { profiles: [{ id: 7001, name: 'Sample Studio LLC' }, { id: 7002, name: 'Second LLC' }] },
    });
    expect(await first(env.DB, 'SELECT 1 FROM wise_connection')).toBeNull();
    const picked = await call(wiseApp(fake), '', put({ token: TOKEN, profileId: 7002 }));
    expect(picked.body.connection).toMatchObject({ connected: true, profileName: 'Second LLC' });
  });

  it('a statement Wise refuses leaves the connection saved, with the reason on it', async () => {
    const fake = new FakeWise();
    fake.statementStatus = 403;
    const res = await call(wiseApp(fake), '', put({ token: TOKEN }));
    expect(res.status).toBe(200);
    expect(res.body.sync).toBeNull();
    expect(res.body.syncError).toBe(WISE_MESSAGES.wise_statement);
    expect(res.body.connection).toMatchObject({ connected: false, status: 'error', lastError: WISE_MESSAGES.wise_statement });
    // The daily sync tries a connection in error again, and it recovers.
    fake.statementStatus = 200;
    expect(await syncAllWiseDaily(wenv, { fetch: fake.fetch })).toEqual({ synced: 1, failed: 0 });
    expect((await call(wiseApp(fake), '')).body.connection.status).toBe('connected');
  });

  it('a reconnect keeps the webhook address, and disconnect drops the token and the webhook', async () => {
    const fake = new FakeWise();
    const app = wiseApp(fake);
    const first1 = await call(app, '', put({ token: TOKEN }));
    const again = await call(app, '', put({ token: TOKEN }));
    expect(again.body.connection.webhook.url).toBe(first1.body.connection.webhook.url);
    expect(fake.subscriptions).toHaveLength(1);

    const off = await call(app, '', { method: 'DELETE' });
    expect(off.body.connection).toMatchObject({ connected: false, status: null, tokenLast4: null });
    expect(fake.subscriptions).toHaveLength(0);
    expect((await first<{ token_enc: string | null }>(env.DB, 'SELECT token_enc FROM wise_connection WHERE business_id = 1'))!.token_enc).toBeNull();
    expect((await call(app, '/sync', { method: 'POST' })).status).toBe(409);
    // Rows already pulled stay.
    expect((await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM bank_transactions'))!.n).toBe(4);
  });

  it('a Wise connection alone opens the bank dashboard tab', async () => {
    expect(await financyTabAvailable(env.DB, 1)).toBe(false);
    await call(wiseApp(new FakeWise()), '', put({ token: TOKEN }));
    expect(await financyTabAvailable(env.DB, 1)).toBe(true);
  });
});

describe('R49: the rows of a Wise statement', () => {
  it('skips a row with no reference, date or amount, and numbers two rows of one reference', () => {
    const rows = wiseTransactions({ id: 9, currency: 'usd' }, [
      { type: 'CREDIT', date: '2026-11-02T10:00:00Z', amount: { value: 10 }, referenceNumber: 'TRANSFER-1' },
      { type: 'DEBIT', date: '2026-11-02T10:00:00Z', amount: { value: 1 }, referenceNumber: 'TRANSFER-1' },
      { type: 'CREDIT', date: '2026-11-02T10:00:00Z', amount: { value: 10 }, referenceNumber: null },
      { type: 'CREDIT', date: null as unknown as string, amount: { value: 10 }, referenceNumber: 'TRANSFER-2' },
      { type: 'CREDIT', date: '2026-11-02T10:00:00Z', amount: { value: 0 }, referenceNumber: 'TRANSFER-3' },
    ]);
    expect(rows.map((r) => [r.id, r.amount?.chargedAmount?.amount, r.amount?.chargedAmount?.currency])).toEqual([
      ['wise:9:TRANSFER-1', '10.00', 'USD'],
      ['wise:9:TRANSFER-1#2', '-1.00', 'USD'],
    ]);
  });
});

describe('R49: money in that arrived net of a wire fee', () => {
  it('suggests the payment request for the amount the payer sent', async () => {
    const app = businessesApp();
    const pr = await finalPaymentRequest(app, 1, 300000);
    const doc = await first<{ date: string; currency: string }>(env.DB, 'SELECT date, currency FROM documents WHERE id = ?', pr.id);
    const { lastRowId } = await run(
      env.DB,
      `INSERT INTO bank_transactions (business_id, financy_id, account_financy_id, kind, booked_on, amount_minor, currency, original_amount_minor, original_currency)
       VALUES (1, 'wise:501:TRANSFER-77', 'wise:501', 'BANK', ?, 299389, ?, 300000, ?)`,
      doc!.date,
      doc!.currency,
      doc!.currency,
    );
    await matchBankTransactions(env.DB, 1);
    const row = await first<{ match_status: string; matched_document_id: number | null }>(env.DB, 'SELECT match_status, matched_document_id FROM bank_transactions WHERE id = ?', lastRowId);
    expect(row).toEqual({ match_status: 'unmatched', matched_document_id: pr.id });
  });
});

describe('R49: the Wise webhook', () => {
  it('checks a signature with the key', async () => {
    const body = new TextEncoder().encode('{"a":1}');
    expect(await verifyWiseSignature(body.buffer as ArrayBuffer, await sign('{"a":1}'), publicPem)).toBe(true);
    expect(await verifyWiseSignature(body.buffer as ArrayBuffer, await sign('{"a":2}'), publicPem)).toBe(false);
    expect(await verifyWiseSignature(body.buffer as ArrayBuffer, 'not base64 !!', publicPem)).toBe(false);
    expect(await verifyWiseSignature(body.buffer as ArrayBuffer, '', publicPem)).toBe(false);
    // The real Wise key refuses a signature made with another key.
    expect(await verifyWiseSignature(body.buffer as ArrayBuffer, await sign('{"a":1}'))).toBe(false);
  });

  it('refuses a body with no signature or a wrong one, before saying whether the address exists', async () => {
    const app = wiseApp(new FakeWise());
    await call(app, '', put({ token: TOKEN }));
    const id = await hookIdOf();
    const body = event('credit');
    expect((await hook(app, id, body, {})).status).toBe(401);
    expect((await hook(app, id, body, { 'X-Signature-SHA256': await sign(`${body} `) })).status).toBe(401);
    expect((await hook(app, 'no-such-hook', body, {})).status).toBe(401);
    expect((await hook(app, 'no-such-hook', body, { 'X-Signature-SHA256': await sign(body) })).status).toBe(404);
  });

  it('answers the test event Wise sends when the webhook is made, and notes that an event arrived', async () => {
    const fake = new FakeWise();
    const app = wiseApp(fake);
    await call(app, '', put({ token: TOKEN }));
    fake.calls = [];
    const body = JSON.stringify({ event_type: 'balances#update', data: {} });
    const res = await hook(app, await hookIdOf(), body, { 'X-Signature-SHA256': await sign(body), 'X-Test-Notification': 'true' });
    expect(res).toEqual({ status: 200, body: { ok: true, test: true } });
    expect(fake.calls).toEqual([]);
    expect((await call(app, '')).body.connection.webhook.lastEventAt).toBeTruthy();
  });

  it('money in pulls the last week and brings the new deposit, with its payer', async () => {
    const fake = new FakeWise();
    const app = wiseApp(fake);
    fake.usdRows = USD_ROWS.slice(1);
    await call(app, '', put({ token: TOKEN }));
    expect(await first(env.DB, "SELECT 1 FROM bank_transactions WHERE financy_id = 'wise:501:TRANSFER-900001'")).toBeNull();

    fake.usdRows = USD_ROWS;
    fake.calls = [];
    const body = event('credit');
    const res = await hook(app, await hookIdOf(), body, { 'X-Signature-SHA256': await sign(body), 'X-Delivery-Id': crypto.randomUUID() });
    expect(res).toEqual({ status: 200, body: { ok: true, synced: true } });
    expect(fake.calls).toContain(`GET /2026Q4/profiles/${BUSINESS.id}/balance-statements/501/statement.json`);
    const row = await first<{ amount_minor: number; merchant: string; description: string }>(env.DB, "SELECT amount_minor, merchant, description FROM bank_transactions WHERE financy_id = 'wise:501:TRANSFER-900001'");
    expect(row).toEqual({ amount_minor: 299389, merchant: 'ACME INC', description: 'Received money from ACME INC with reference INV 40021' });
  });

  it('reads the older deposit event too', async () => {
    const fake = new FakeWise();
    const app = wiseApp(fake);
    await call(app, '', put({ token: TOKEN }));
    fake.calls = [];
    const body = event('credit', BUSINESS.id, 'balances#credit');
    expect((await hook(app, await hookIdOf(), body, { 'X-Signature-SHA256': await sign(body) })).body).toEqual({ ok: true, synced: true });
  });

  it('money out, another profile and another event are acknowledged and pull nothing', async () => {
    const fake = new FakeWise();
    const app = wiseApp(fake);
    await call(app, '', put({ token: TOKEN }));
    const id = await hookIdOf();
    fake.calls = [];
    for (const body of [event('debit'), event('credit', 9999), event('credit', BUSINESS.id, 'transfers#state-change'), 'not json']) {
      const res = await hook(app, id, body, { 'X-Signature-SHA256': await sign(body) });
      expect(res).toEqual({ status: 200, body: { ok: true, synced: false } });
    }
    expect(fake.calls).toEqual([]);
  });

  it('answers 200 even when the sync fails, and 404 once Wise is disconnected', async () => {
    const fake = new FakeWise();
    const app = wiseApp(fake);
    await call(app, '', put({ token: TOKEN }));
    const id = await hookIdOf();
    fake.statementStatus = 403;
    const body = event('credit');
    expect((await hook(app, id, body, { 'X-Signature-SHA256': await sign(body) })).status).toBe(200);
    expect((await call(app, '')).body.connection.status).toBe('error');
    await call(app, '', { method: 'DELETE' });
    expect((await hook(app, id, body, { 'X-Signature-SHA256': await sign(body) })).status).toBe(404);
  });
});
