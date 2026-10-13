import { env as baseEnv } from 'cloudflare:workers';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { all, first, run } from '../../../src/core/db';
import type { Env } from '../../../src/env';
import { createApp } from '../../../src/index';
import { modules as registered } from '../../../src/modules';
import { createContractsModule, createContractsPublicModule, FakeContractPdfEngine } from '../../../src/modules/contracts';
import { createDemoAppModule, createDemoModule } from '../../../src/modules/demo';
import { READ_ONLY_MESSAGE } from '../../../src/modules/demo/guard';
import { fingerprintOf, SAMPLE_VERSION } from '../../../src/modules/demo/sample';
import { samplePng } from '../../../src/modules/demo/png';
import { injectWatermark, withDemoWatermark } from '../../../src/modules/demo/watermark';
import { FakePdfEngine, renderDocument } from '../../../src/modules/pdf';
import { FakeMailer } from '../../../src/modules/sending';
import { sampleRenderDocument } from '../../fixtures/pdf/sample';
import { demoTestEnv } from './helpers';

/**
 * R26, R29: demo mode end to end. The gate, leads and consent, instant entry to the shared sample
 * set, the read-only guard on every write route, private drafts, previews instead of issuing,
 * sending, recording a payment and signing, caps, the watermark, the fake Tax Authority with no
 * network, and the admin behind Access.
 */

const TEAM = 'https://mtn-test.cloudflareaccess.com';
const AUD = 'test-aud';
let privateKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;
const adminJwt = (email: string) =>
  new SignJWT({ email }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(TEAM).setAudience(AUD).setIssuedAt().setExpirationTime('5m').sign(privateKey);

const webhook: { body: any; secret: string | null }[] = [];
let turnstileOk = true;
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://challenges.cloudflare.com/')) return Response.json({ success: turnstileOk });
  if (url.startsWith('https://leads.test/')) {
    webhook.push({ body: JSON.parse(String(init?.body)), secret: new Headers(init?.headers).get('X-Lead-Secret') });
    return Response.json({ ok: true });
  }
  if (url.startsWith('https://hooks.slack.test/')) return new Response('ok');
  throw new Error(`unexpected network call ${url}`);
};

const gateMail = new FakeMailer();
let mailOn = true;
const engine = new FakeContractPdfEngine();
const app = createApp({
  modules: [
    ...registered.filter((m) => !['contracts', 'contracts-public', 'demo', 'demo-app'].includes(m.name)),
    createContractsModule({ engineFor: () => engine }),
    createContractsPublicModule({ engineFor: () => engine }),
    createDemoModule({ fetchFn: fakeFetch, mailerFor: () => (mailOn ? gateMail : null) }),
    createDemoAppModule({ engineFor: () => engine }),
  ],
  demoAdmin: { keyResolver: () => jwks, fetchFn: fakeFetch },
});

const env: Env = {
  ...demoTestEnv(),
  // The raw Worker bindings: the app applies the demo env itself.
  SIGNING_KEY_PEM: undefined,
  SIGNING_CERT_PEM: undefined,
  ITA_VAT_NUMBER: undefined,
  OWNER_TAX_ID: undefined,
  DEMO_LEAD_WEBHOOK_URL: 'https://leads.test/demo-lead',
  DEMO_LEAD_SECRET: 'lead-secret',
  ADMIN_EMAILS: 'admin@example.com',
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  PUBLIC_APP_URL: 'https://sample.test',
} as Env;

async function call(path: string, init: RequestInit & { cookie?: string; business?: number } = {}, e: Env = env) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('Cookie', init.cookie);
  if (init.business) headers.set('X-Business-Id', String(init.business));
  if (init.body && typeof init.body === 'string' && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return app.request(path, { ...init, headers }, e);
}

async function enter(name: string, email: string, opts: { consent?: boolean; cookie?: string } = {}) {
  const form = new URLSearchParams({ name, email, lang: 'en', 'cf-turnstile-response': 'ok-token' });
  if (opts.consent) form.set('consent', 'yes');
  return call('/api/demo/enter', { method: 'POST', body: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '198.51.100.7', 'User-Agent': 'vitest browser' }, cookie: opts.cookie });
}

const cookieOf = (res: Response) => /ledger_demo=[^;]+/.exec(res.headers.get('set-cookie') ?? '')?.[0] ?? '';
const json = async (res: Response) => (await res.json()) as any;
const count = async (sql: string, ...p: (string | number)[]) => (await first<{ n: number }>(env.DB, sql, ...p))!.n;
const png = () => `data:image/png;base64,${btoa(String.fromCharCode(...samplePng(120, 40, 30)))}`;

let visitorA = '';
let visitorB = '';
let masters: number[] = [];
let biz = 0;
let company = 0;

/** Every sample row of every table with business_id in the masters, read independently of the code under test. */
async function sampleSnapshot(): Promise<string> {
  const names = (await all<{ name: string }>(env.DB, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")).map((r) => r.name);
  const parts: string[] = [];
  for (const n of names) {
    const cols = (await all<{ name: string }>(env.DB, `SELECT name FROM pragma_table_info('${n}')`)).map((c) => c.name);
    if (!cols.includes('business_id') || ['audit_log', 'demo_outbox', 'user_businesses', 'demo_master_businesses'].includes(n)) continue;
    const where = cols.includes('demo_session_id') ? ' AND demo_session_id IS NULL' : '';
    parts.push(`${n}:${JSON.stringify(await all(env.DB, `SELECT * FROM "${n}" WHERE business_id IN (${masters.join(',')})${where} ORDER BY rowid`))}`);
  }
  return parts.join('\n');
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] });
  // The first entry builds the sample set once.
  const a = await enter('Dana Visitor', 'dana@example.com');
  expect(a.status).toBe(303);
  visitorA = cookieOf(a);
  const b = await enter('Avi Visitor', 'avi@example.com', { consent: true });
  visitorB = cookieOf(b);
  masters = (await all<{ business_id: number }>(env.DB, 'SELECT business_id FROM demo_master_businesses ORDER BY business_id')).map((r) => r.business_id);
  biz = masters[0]!;
  company = masters[1]!;
}, 180_000);

afterEach(() => vi.restoreAllMocks());

describe('demo mode off', () => {
  it('changes nothing: no demo route answers and no gate shows', async () => {
    const off = { ...baseEnv, DEMO_MODE: '' } as Env;
    for (const path of ['/api/demo/enter', '/api/demo-app/status', '/api/admin/summary', '/admin', '/admin/api/summary']) {
      const res = await app.request(path, { method: path.endsWith('enter') ? 'POST' : 'GET' }, off);
      expect([401, 403, 404], path).toContain(res.status);
    }
    const root = await app.request('/', {}, off);
    expect(await root.text()).not.toContain('Enter the demo');
  });
});

describe('the gate', () => {
  it('refuses to start next to real credentials', async () => {
    const res = await app.request('/', {}, { ...env, ITA_CLIENT_ID_PRODUCTION: 'real-client' } as Env);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('Demo misconfigured');
    const cert = await app.request('/', {}, { ...env, SIGNING_CERT_PEM: '-----BEGIN CERTIFICATE-----\nnot the demo\n-----END CERTIFICATE-----' } as Env);
    expect(cert.status).toBe(503);
  });

  it('shows the gate without a session: name, email, an unticked box, Turnstile, the privacy link', async () => {
    const html = await (await call('/?lang=en')).text();
    expect(html).toContain('Enter the demo');
    expect(html).toContain('The sample data is read-only.');
    expect(html).toContain('name="consent" value="yes"');
    expect(html).not.toMatch(/name="consent"[^>]*checked/);
    expect(html).toContain('data-sitekey="1x00000000000000000000AA"');
    expect(html).toContain('Send me updates and offers from Sample Sender by email.');
    expect(html).toContain('href="/privacy?lang=en"');
    expect(await (await call('/privacy?lang=he')).text()).toContain('הודעת פרטיות');
    expect(await (await call('/privacy?lang=en')).text()).toContain('deleted 30 minutes after you leave');
    expect((await call('/api/me')).status).toBe(401);
  });

  it('opens in Hebrew by default and remembers the language for the app', async () => {
    const html = await (await call('/')).text();
    expect(html).toContain('lang="he"');
    expect(html).toContain("localStorage.setItem('open-ledger-il-locale','he')");
  });

  it('refuses a failed Turnstile check', async () => {
    turnstileOk = false;
    try {
      expect((await enter('Bot', 'bot@example.com')).status).toBe(400);
    } finally {
      turnstileOk = true;
    }
  });

  it('stores the lead, the consent record, forwards both with the secret, and sets an HttpOnly cookie', async () => {
    const lead = (await first<any>(env.DB, "SELECT * FROM demo_leads WHERE email = 'avi@example.com'"))!;
    expect(lead.ip).toBe('198.51.100.7');
    const consent = (await first<any>(env.DB, 'SELECT * FROM demo_consents WHERE lead_id = ?', lead.id))!;
    expect(consent).toMatchObject({ consent: 1, text_version: '2026-10-13', confirmed_at: null });
    const sent = webhook.find((w) => w.body.email === 'avi@example.com')!;
    expect(sent.secret).toBe('lead-secret');
    expect(sent.body).toMatchObject({ event: 'lead', consent: 'yes', consentTextVersion: '2026-10-13' });
    const mail = gateMail.sent.find((m) => m.to === 'avi@example.com')!;
    expect(mail.text).toContain('/api/demo/confirm/');
    expect(mail.text).toContain('/api/demo/unsubscribe/');
    const res = await enter('Someone', 'someone@example.com');
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    expect(await (await call('/', { cookie: visitorA })).text()).not.toContain('Enter the demo');
  });

  it('confirms and unsubscribes through the signed links, and tells the webhook', async () => {
    const mail = gateMail.sent.find((m) => m.to === 'avi@example.com')!;
    const confirm = /https:\/\/sample\.test(\/api\/demo\/confirm\/\S+)/.exec(mail.text)![1]!;
    expect((await call(confirm)).status).toBe(200);
    const lead = (await first<any>(env.DB, "SELECT id FROM demo_leads WHERE email = 'avi@example.com'"))!;
    expect((await first<any>(env.DB, 'SELECT confirmed_at FROM demo_consents WHERE lead_id = ?', lead.id))!.confirmed_at).not.toBeNull();
    const unsub = /https:\/\/sample\.test(\/api\/demo\/unsubscribe\/\S+)/.exec(mail.text)![1]!;
    expect((await call(unsub)).status).toBe(200);
    expect(webhook.some((w) => w.body.email === 'avi@example.com' && w.body.event === 'unsubscribe')).toBe(true);
    await expect(run(env.DB, 'DELETE FROM demo_consents WHERE lead_id = ?', lead.id)).rejects.toThrow(/append.only/);
  });
});

describe('instant entry', () => {
  it('opens the shared sample set with no copy, in well under 2 seconds', async () => {
    const businesses = await count('SELECT COUNT(*) AS n FROM businesses');
    const documents = await count('SELECT COUNT(*) AS n FROM documents');
    const started = Date.now();
    const res = await enter('Fast Visitor', 'fast@example.com');
    const ms = Date.now() - started;
    console.log(`demo entry: ${ms} ms`);
    expect(res.status).toBe(303);
    expect(ms).toBeLessThan(2000);
    expect(await count('SELECT COUNT(*) AS n FROM businesses')).toBe(businesses);
    expect(await count('SELECT COUNT(*) AS n FROM documents')).toBe(documents);
    const ids = (await json(await call('/api/me', { cookie: cookieOf(res) }))).user.businesses.map((x: any) => x.id);
    expect(ids).toEqual(masters);
  });

  it('every visitor opens the same sample businesses', async () => {
    const me = async (cookie: string) => (await json(await call('/api/me', { cookie }))).user;
    const a = await me(visitorA);
    const b = await me(visitorB);
    expect(a.businesses.map((x: any) => x.id)).toEqual(masters);
    expect(b.businesses.map((x: any) => x.id)).toEqual(masters);
    expect(a.demo.ownKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.demo.ownKey).not.toBe(b.demo.ownKey);
  });

  it('the same email reopens the same session: this browser at once, another after an email code', async () => {
    const keyA = (await json(await call('/api/me', { cookie: visitorA }))).user.demo.ownKey;
    expect((await enter('Dana Visitor', 'dana@example.com', { cookie: visitorA })).status).toBe(303);
    const other = await enter('Dana Visitor', 'dana@example.com');
    expect(other.status).toBe(200);
    expect(await other.text()).toContain('Welcome back');
    const code = /(\d{6})/.exec(gateMail.sent[gateMail.sent.length - 1]!.text)![1]!;
    const form = (c: string) => ({ method: 'POST', body: new URLSearchParams({ email: 'dana@example.com', code: c }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect((await call('/api/demo/verify', form(code === '000000' ? '111111' : '000000'))).status).toBe(400);
    const ok = await call('/api/demo/verify', form(code));
    expect(ok.status).toBe(303);
    visitorA = cookieOf(ok);
    expect((await json(await call('/api/me', { cookie: visitorA }))).user.demo.ownKey).toBe(keyA);
  });

  it('a visitor who arrives while the sample set builds waits on a page that reloads', async () => {
    await run(env.DB, 'UPDATE demo_master_businesses SET seed_version = 0');
    await run(env.DB, "INSERT INTO demo_build_lock (id, holder, started_at, expires_at) VALUES (1, 'other', ?, ?)", new Date().toISOString(), new Date(Date.now() + 60_000).toISOString());
    try {
      const res = await call('/documents?lang=en', { cookie: visitorB });
      expect(res.status).toBe(503);
      // A deep link without a session gets the gate, not the app.
      expect(await (await call('/documents?lang=en')).text()).toContain('Enter the demo');
      const html = await res.text();
      expect(html).toContain('Preparing the sample data, one moment');
      expect(html).toContain('http-equiv="refresh" content="5"');
    } finally {
      await run(env.DB, 'DELETE FROM demo_build_lock');
      await run(env.DB, 'UPDATE demo_master_businesses SET seed_version = ?', SAMPLE_VERSION);
    }
  });
});

/** A sample row id per table, for the guard test. */
async function sampleIds() {
  const pick = async (sql: string) => (await first<{ id: number }>(env.DB, sql, biz))!.id;
  return {
    documents: await pick("SELECT id FROM documents WHERE business_id = ? AND status = 'final' AND type = 'PR' AND demo_session_id IS NULL LIMIT 1"),
    clients: await pick('SELECT id FROM clients WHERE business_id = ? AND demo_session_id IS NULL LIMIT 1'),
    contracts: await pick("SELECT id FROM contracts WHERE business_id = ? AND status = 'signed' AND demo_session_id IS NULL LIMIT 1"),
    expenses: await pick('SELECT id FROM expenses WHERE business_id = ? AND demo_session_id IS NULL LIMIT 1'),
    suppliers: await pick('SELECT id FROM suppliers WHERE business_id = ? AND demo_session_id IS NULL LIMIT 1'),
    contacts: await pick('SELECT cc.id FROM client_contacts cc JOIN clients c ON c.id = cc.client_id WHERE c.business_id = ? LIMIT 1'),
  };
}

describe('the sample data is read-only', () => {
  it('every write route refuses the sample set, and the sample set does not change', async () => {
    const ids = await sampleIds();
    const before = await sampleSnapshot();
    const fingerprints = await Promise.all(masters.map((m) => fingerprintOf(env.DB, m)));
    // The creates and pure reads a visitor may call. They make private rows or read only.
    const open = [
      /^POST \/api\/clients$/,
      /^POST \/api\/documents$/,
      /^POST \/api\/documents\/:id\/duplicate$/,
      /^POST \/api\/pdf\/documents\/:id\/(view|download)$/,
      /^POST \/api\/expenses\/(upload|suppliers)$/,
      /^POST \/api\/contracts(\/preview)?$/,
      /^PATCH \/api\/me\/preferences$/,
      /^POST \/api\/demo-app\//,
      /^POST \/api\/ita\/refresh$/,
      /^POST \/api\/demo\//,
      /^(POST|PUT|PATCH|DELETE) \/api\/(sending\/public|admin)\//,
      /^(POST|PUT|PATCH|DELETE) \/(admin|mcp)\b/,
    ];
    const routes = [...new Set(app.routes.filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method)).map((r) => `${r.method} ${r.path}`))];
    expect(routes.length).toBeGreaterThan(80);
    let checked = 0;
    for (const route of routes) {
      if (open.some((p) => p.test(route))) continue;
      const [method, pattern] = route.split(' ') as [string, string];
      const resource = /^\/api\/([^/]+)/.exec(pattern)?.[1] ?? '';
      const idFor: Record<string, number> = { clients: ids.clients, documents: ids.documents, pdf: ids.documents, sending: ids.documents, contracts: ids.contracts, expenses: pattern.includes('suppliers') ? ids.suppliers : ids.expenses, ita: ids.documents };
      const path = pattern
        .replace(':contactId', String(ids.contacts))
        .replace(/:documentId|:id/g, String(idFor[resource] ?? 1))
        .replace(/:[A-Za-z]+/g, '1');
      const res = await call(path, { method, cookie: visitorA, business: biz, body: '{}' });
      expect(res.status, route).toBe(403);
      expect((await json(res)).error.code, route).toBe('demo_read_only');
      checked++;
    }
    expect(checked).toBeGreaterThan(70);
    // The Tax Authority always looks connected to a visitor, and reconnecting stores nothing.
    const connect = await call('/api/ita/connect', { cookie: visitorA, business: company, redirect: 'manual' });
    expect(connect.status).toBe(302);
    expect(connect.headers.get('location')).toBe('/ita?connected=1');
    expect((await json(await call('/api/ita/status', { cookie: visitorA, business: company }))).connection.connected).toBe(true);
    expect(await json(await call('/api/ita/refresh', { method: 'POST', cookie: visitorA, business: company, body: '{}' }))).toEqual({ ok: true, from: 'demo' });
    expect((await json(await call('/api/ita/route-check', { cookie: visitorA, business: company }))).direct.reached).toBe(true);
    expect(await sampleSnapshot()).toBe(before);
    expect(await Promise.all(masters.map((m) => fingerprintOf(env.DB, m)))).toEqual(fingerprints);
  }, 120_000);

  it('says why in one line', async () => {
    const res = await call('/api/ops/business', { method: 'PUT', cookie: visitorA, business: biz, body: JSON.stringify({ nameEn: 'Hacked' }) });
    expect(res.status).toBe(403);
    expect((await json(res)).error.message).toBe(READ_ONLY_MESSAGE);
    expect(READ_ONLY_MESSAGE.startsWith('Read-only in the demo')).toBe(true);
    // Reads stay open.
    expect((await call('/api/ops/business', { cookie: visitorA, business: biz })).status).toBe(200);
  });
});

describe('private drafts', () => {
  let clientId = 0;
  let draftId = 0;

  it('a visitor creates and edits a client and a draft, and only that visitor sees them', async () => {
    const c = await call('/api/clients', { method: 'POST', cookie: visitorA, business: biz, body: JSON.stringify({ nameEn: 'Dana Private Client', country: 'IL', currency: 'ILS' }) });
    expect(c.status).toBe(201);
    clientId = (await json(c)).client.id;
    const d = await call('/api/documents', { method: 'POST', cookie: visitorA, business: biz, body: JSON.stringify({ type: 'PR', clientId, lines: [{ description: 'Private work', unitPriceMinor: 25000 }] }) });
    expect(d.status).toBe(201);
    draftId = (await json(d)).document.id;
    expect((await call(`/api/documents/${draftId}`, { method: 'PATCH', cookie: visitorA, business: biz, body: JSON.stringify({ notes: 'Edited' }) })).status).toBe(200);
    expect((await call(`/api/clients/${clientId}`, { method: 'PATCH', cookie: visitorA, business: biz, body: JSON.stringify({ phone: '050-0000099' }) })).status).toBe(200);

    const listA = (await json(await call('/api/documents', { cookie: visitorA, business: biz }))).items.map((x: any) => x.id);
    const listB = (await json(await call('/api/documents', { cookie: visitorB, business: biz }))).items.map((x: any) => x.id);
    expect(listA).toContain(draftId);
    expect(listB).not.toContain(draftId);
    // Both see the same sample documents.
    expect(listB.every((id: number) => listA.includes(id))).toBe(true);
    const search = (cookie: string) => call('/api/clients?q=Dana%20Private', { cookie, business: biz }).then(json);
    expect((await search(visitorA)).clients).toHaveLength(1);
    expect((await search(visitorB)).clients).toHaveLength(0);
    // Another visitor cannot read, change or delete them.
    expect((await call(`/api/documents/${draftId}`, { cookie: visitorB, business: biz })).status).toBe(404);
    expect((await call(`/api/documents/${draftId}`, { method: 'PATCH', cookie: visitorB, business: biz, body: '{}' })).status).toBe(404);
    expect((await call(`/api/documents/${draftId}`, { method: 'DELETE', cookie: visitorB, business: biz })).status).toBe(404);
    expect((await call(`/api/clients/${clientId}`, { cookie: visitorB, business: biz })).status).toBe(404);
    // The rows carry the session key. The sample set's rows carry none.
    const keyA = (await json(await call('/api/me', { cookie: visitorA }))).user.demo.ownKey;
    expect((await first<{ demo_session_id: string }>(env.DB, 'SELECT demo_session_id FROM documents WHERE id = ?', draftId))!.demo_session_id).toBe(keyA);
    expect(await count('SELECT COUNT(*) AS n FROM documents WHERE business_id = ? AND demo_session_id IS NULL AND status = ?', biz, 'draft')).toBe(0);
  });

  it('the dashboard ignores drafts: both visitors see the same numbers', async () => {
    const a = await json(await call('/api/dashboard', { cookie: visitorA, business: biz }));
    const b = await json(await call('/api/dashboard', { cookie: visitorB, business: biz }));
    const strip = (x: any) => JSON.stringify({ ...x, whatsappDue: undefined, activity: undefined });
    expect(strip(a)).toBe(strip(b));
  });

  it('a copy of a sample document is a private draft', async () => {
    const ids = await sampleIds();
    const res = await call(`/api/documents/${ids.documents}/duplicate`, { method: 'POST', cookie: visitorB, business: biz });
    expect(res.status).toBe(201);
    const copy = (await json(res)).document.id;
    expect((await call(`/api/documents/${copy}`, { cookie: visitorA, business: biz })).status).toBe(404);
  });

  describe('previews instead of actions', () => {
    it('Issue: the finished PDF with 0000 and a "Demo, not issued" watermark, and nothing numbered, hashed or locked', async () => {
      expect((await call(`/api/documents/${draftId}/finalize`, { method: 'POST', cookie: visitorA, business: biz, body: '{}' })).status).toBe(403);
      const res = await call(`/api/demo-app/documents/${draftId}/issue-preview`, { method: 'POST', cookie: visitorA, business: biz });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      const html = engine.renders[engine.renders.length - 1]!;
      expect(html).toContain('0000');
      expect(html).toContain('DEMO · NOT ISSUED');
      expect(html).not.toContain('DRAFT, NOT A VALID DOCUMENT');
      const row = (await first<any>(env.DB, 'SELECT status, number, hash, prev_hash, finalized_at FROM documents WHERE id = ?', draftId))!;
      expect(row).toEqual({ status: 'draft', number: null, hash: null, prev_hash: null, finalized_at: null });
      expect(await count('SELECT COUNT(*) AS n FROM finalizations WHERE document_id = ?', draftId)).toBe(0);
      // Only for the visitor's own draft.
      expect((await call(`/api/demo-app/documents/${draftId}/issue-preview`, { method: 'POST', cookie: visitorB, business: biz })).status).toBe(404);
      expect((await call(`/api/demo-app/documents/${(await sampleIds()).documents}/issue-preview`, { method: 'POST', cookie: visitorA, business: biz })).status).toBe(403);
    });

    it('Record payment: the receipt that would be issued, watermarked, and no receipt stored', async () => {
      const docs = await count('SELECT COUNT(*) AS n FROM documents');
      const res = await call(`/api/demo-app/documents/${draftId}/receipt-preview`, { method: 'POST', cookie: visitorA, business: biz, body: JSON.stringify({ payments: [{ method: 'bank_transfer', amountMinor: 25000 }] }) });
      expect(res.status).toBe(200);
      const html = engine.renders[engine.renders.length - 1]!;
      expect(html).toContain('0000');
      expect(html).toContain('DEMO · NOT ISSUED');
      expect(html).toMatch(/Receipt/i);
      expect(await count('SELECT COUNT(*) AS n FROM documents')).toBe(docs);
      expect(await count('SELECT COUNT(*) AS n FROM payments WHERE document_id = ?', draftId)).toBe(0);
      expect((await call(`/api/documents/${draftId}/record-payment`, { method: 'POST', cookie: visitorA, business: biz, body: '{}' })).status).toBe(403);
    });

    it('Send: the email shows in the outbox preview, only for this visitor, and nothing is sent', async () => {
      const spy = vi.spyOn(globalThis, 'fetch');
      await call(`/api/clients/${clientId}`, { method: 'PATCH', cookie: visitorA, business: biz, body: JSON.stringify({ email: 'client@example.com' }) });
      const res = await call(`/api/demo-app/documents/${draftId}/send-preview`, { method: 'POST', cookie: visitorA, business: biz, body: '{}' });
      expect(res.status).toBe(200);
      expect((await json(res)).email).toMatchObject({ to_addr: 'client@example.com', subject: expect.stringContaining('PR-0000') });
      const mine = (await json(await call('/api/demo-app/outbox', { cookie: visitorA, business: biz }))).emails;
      const theirs = (await json(await call('/api/demo-app/outbox', { cookie: visitorB, business: biz }))).emails;
      expect(mine[0].to_addr).toBe('client@example.com');
      expect(theirs.some((e: any) => e.to_addr === 'client@example.com')).toBe(false);
      expect(spy.mock.calls.filter(([u]) => /resend\.com/.test(String(u)))).toEqual([]);
      expect(await count("SELECT COUNT(*) AS n FROM send_log WHERE document_id = ?", draftId)).toBe(0);
      expect((await call(`/api/sending/documents/${draftId}/send`, { method: 'POST', cookie: visitorA, business: biz, body: '{}' })).status).toBe(403);
    });

    it('Contract: the real signing page in preview mode, Sign returns the PDF, and nothing is stored as signed', async () => {
      const template = (await json(await call('/api/contracts/templates', { cookie: visitorA, business: biz }))).templates.find((t: any) => t.name === 'Service Agreement');
      const created = await call('/api/contracts', { method: 'POST', cookie: visitorA, business: biz, body: JSON.stringify({ clientId, templateId: template.id, values: {}, signer: { name: 'Test Signer', email: 'signer@example.com' } }) });
      expect(created.status).toBe(201);
      const id = (await json(created)).contract.id;
      expect((await call(`/api/contracts/${id}/send`, { method: 'POST', cookie: visitorA, business: biz, body: JSON.stringify({ channel: 'email' }) })).status).toBe(403);
      const page = await call(`/api/demo-app/sign-preview/c/${id}?lang=en`, { cookie: visitorA, business: biz });
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain('Demo preview. This is the page your client signs on.');
      expect(html).toContain(`/api/demo-app/sign-preview/c/${id}`);
      expect((await call(`/api/demo-app/sign-preview/c/${id}/view`, { cookie: visitorA, business: biz })).status).toBe(200);
      // The signer fills the fields the page shows, then signs.
      const values = Object.fromEntries([...html.matchAll(/data-key="([^"]+)"/g)].map((m) => [m[1], 'Test Signer']));
      const signed = await call(`/api/demo-app/sign-preview/c/${id}/sign`, { method: 'POST', cookie: visitorA, business: biz, body: JSON.stringify({ values, signaturePng: png(), consent: true }) });
      expect(signed.status).toBe(200);
      const body = await json(signed);
      expect(atob(body.pdfBase64).startsWith('%PDF')).toBe(true);
      expect(engine.renders[engine.renders.length - 1]).toContain('DEMO · NOT SIGNED');
      const row = (await first<any>(env.DB, 'SELECT status, signed_at, signed_pdf_r2_key, sent_pdf_r2_key FROM contracts WHERE id = ?', id))!;
      expect(row).toEqual({ status: 'draft', signed_at: null, signed_pdf_r2_key: null, sent_pdf_r2_key: null });
      expect(await count("SELECT COUNT(*) AS n FROM contract_events WHERE contract_id = ? AND kind IN ('sent', 'signed', 'viewed')", id)).toBe(0);
      // Another visitor cannot open it.
      expect((await call(`/api/demo-app/sign-preview/c/${id}`, { cookie: visitorB, business: biz })).status).toBe(404);
    });

    it('the sample set’s signed contracts stay viewable', async () => {
      const ids = await sampleIds();
      const res = await call(`/api/contracts/${ids.contracts}/pdf?which=signed`, { cookie: visitorA, business: biz });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/pdf');
    });
  });
});

describe('caps', () => {
  it('stops new drafts at the daily cap with a plain message', async () => {
    const capped = { ...env, DEMO_CAP_DOCUMENTS: '1' } as Env;
    const body = JSON.stringify({ type: 'QT', lines: [{ description: 'Cap test', unitPriceMinor: 100 }] });
    let res = await call('/api/documents', { method: 'POST', cookie: visitorB, business: biz, body }, capped);
    if (res.status === 201) res = await call('/api/documents', { method: 'POST', cookie: visitorB, business: biz, body }, capped);
    expect(res.status).toBe(429);
    expect((await json(res)).error.code).toBe('demo_cap');
  });
});

describe('fakes', () => {
  it('every PDF type and preview carries the watermark in English and Hebrew', async () => {
    const inner = new FakePdfEngine();
    const wrapped = withDemoWatermark(inner, { DEMO_MODE: '1' });
    for (const type of ['QT', 'PR', '300', '400', '405', '320', '330']) {
      for (const variant of ['client', 'filed'] as const) {
        const html = new TextDecoder().decode(await wrapped.renderPdf(renderDocument(sampleRenderDocument({ type }), variant)));
        expect(html).toContain('DEMO · NOT A VALID TAX DOCUMENT');
        expect(html).toContain('הדגמה · אינו מסמך מס תקף');
      }
    }
    expect(withDemoWatermark(inner, { DEMO_MODE: '' })).toBe(inner);
    expect(injectWatermark(injectWatermark('<html><head></head><body>x</body></html>')).match(/ledger-demo-watermark"/g)).toHaveLength(1);
    const doc = (await sampleIds()).documents;
    const preview = await call(`/api/pdf/documents/${doc}?variant=client`, { cookie: visitorA, business: biz });
    expect(await preview.text()).toContain('ledger-demo-watermark');
  });

  it('a receipt upload gets the fixed sample reading, labelled demo', async () => {
    const { DEMO_EXTRACTION, AiExtractor } = await import('../../../src/modules/expenses/extractor');
    const result = await new AiExtractor({ ...env, DEMO_MODE: '1' } as Env).extract({ bytes: new ArrayBuffer(4), contentType: 'image/png', filename: 'r.png' });
    expect(result).toEqual(DEMO_EXTRACTION());
  });
});

describe('admin', () => {
  it('needs an Access JWT for an admin email', async () => {
    expect((await call('/admin')).status).toBe(403);
    expect((await call('/admin', { headers: { 'Cf-Access-Jwt-Assertion': await adminJwt('someone@example.com') } })).status).toBe(403);
    const page = await call('/admin', { headers: { 'Cf-Access-Jwt-Assertion': await adminJwt('admin@example.com') } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Reset now');
  });

  it('shows visitors today, active sessions, drafts today, the last sweep and the last reset', async () => {
    const h = { 'Cf-Access-Jwt-Assertion': await adminJwt('admin@example.com') };
    const summary = await json(await call('/admin/api/summary', { headers: h }));
    expect(summary.visitorsToday).toBeGreaterThanOrEqual(3);
    expect(summary.activeSessions).toBeGreaterThanOrEqual(2);
    expect(summary.draftsToday).toBeGreaterThanOrEqual(2);
    expect(summary).toHaveProperty('lastSweep');
    expect(summary).toHaveProperty('lastReset');
    const csv = await (await call('/admin/api/leads.csv', { headers: h })).text();
    expect(csv).toContain('dana@example.com');
  });

  it('the admin session is the only one that changes the sample set, audited, and the fake Tax Authority answers', async () => {
    const h = { 'Cf-Access-Jwt-Assertion': await adminJwt('admin@example.com') };
    const adminCookie = cookieOf(await call('/admin/api/sample-session', { method: 'POST', headers: h }));
    const put = await call('/api/ops/business', { method: 'PUT', cookie: adminCookie, business: biz, body: JSON.stringify({ phone: '050-0000001' }) });
    expect(put.status).not.toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'demo.admin_write'")).toBeGreaterThan(0);
    // The admin does not see a visitor's drafts.
    const docs = (await json(await call('/api/documents', { cookie: adminCookie, business: biz }))).items;
    expect(docs.every((d: any) => d.status !== 'draft')).toBe(true);
    // The fake Tax Authority: connect at once, DEMO- numbers, never a network call.
    const spy = vi.spyOn(globalThis, 'fetch');
    const connect = await call('/api/ita/connect', { cookie: adminCookie, business: company, redirect: 'manual' });
    const location = new URL(connect.headers.get('location') ?? '', 'https://sample.test');
    expect(location.pathname + location.search).toMatch(/\/api\/ita\/callback\?code=demo/);
    expect((await call(location.pathname + location.search, { cookie: adminCookie, business: company, redirect: 'manual' })).status).toBeLessThan(400);
    const client = (await json(await call('/api/clients', { cookie: adminCookie, business: company }))).clients.find((c: any) => c.name_en === 'Example Tech Ltd');
    const draft = await call('/api/documents', { method: 'POST', cookie: adminCookie, business: company, body: JSON.stringify({ type: '305', clientId: client.id, lines: [{ description: 'Large project', unitPriceMinor: 2000000 }] }) });
    const id = (await json(draft)).document.id;
    expect((await call(`/api/documents/${id}/finalize`, { method: 'POST', cookie: adminCookie, business: company, body: '{}' })).status).toBeLessThan(300);
    const row = (await first<{ status: string; allocation_number: string | null }>(env.DB, 'SELECT status, allocation_number FROM documents WHERE id = ?', id))!;
    if (row.status === 'final') expect(row.allocation_number).toMatch(/^DEMO-\d{9}$/);
    else expect(row.status).toBe('allocation_refused');
    expect(spy.mock.calls.filter(([u]) => /taxes\.gov\.il/.test(String(u instanceof Request ? u.url : u)))).toEqual([]);
  });
});
