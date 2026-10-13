import { env as baseEnv } from 'cloudflare:workers';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { all, first, run } from '../../../src/core/db';
import type { Env } from '../../../src/env';
import { createApp } from '../../../src/index';
import { modules as registered } from '../../../src/modules';
import { createContractsModule, createContractsPublicModule, FakeContractPdfEngine } from '../../../src/modules/contracts';
import { createDemoModule } from '../../../src/modules/demo';
import { injectWatermark, withDemoWatermark } from '../../../src/modules/demo/watermark';
import { FakePdfEngine, renderDocument } from '../../../src/modules/pdf';
import { FakeMailer } from '../../../src/modules/sending';
import { sampleRenderDocument } from '../../fixtures/pdf/sample';
import { demoTestEnv } from './helpers';

/**
 * R26: demo mode end to end. The gate, leads and consent, sandboxes and their isolation, settings
 * read-only with two exceptions, the Ledger's own locks, caps, the watermark, the fake Tax
 * Authority with no network, the email outbox, and the admin behind Access.
 */

const TEAM = 'https://mtn-test.cloudflareaccess.com';
const AUD = 'test-aud';
let privateKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;
const adminJwt = (email: string) =>
  new SignJWT({ email }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(TEAM).setAudience(AUD).setIssuedAt().setExpirationTime('5m').sign(privateKey);

const webhook: { body: any; secret: string | null }[] = [];
const slack: string[] = [];
let turnstileOk = true;
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://challenges.cloudflare.com/')) return Response.json({ success: turnstileOk });
  if (url.startsWith('https://leads.test/')) {
    webhook.push({ body: JSON.parse(String(init?.body)), secret: new Headers(init?.headers).get('X-Lead-Secret') });
    return Response.json({ ok: true });
  }
  if (url.startsWith('https://hooks.slack.test/')) {
    slack.push(JSON.parse(String(init?.body)).text);
    return new Response('ok');
  }
  throw new Error(`unexpected network call ${url}`);
};

const gateMail = new FakeMailer();
let mailOn = true;
const engine = new FakeContractPdfEngine();
const app = createApp({
  modules: [
    ...registered.filter((m) => !['contracts', 'contracts-public', 'demo'].includes(m.name)),
    createContractsModule({ engineFor: () => engine }),
    createContractsPublicModule({ engineFor: () => engine }),
    createDemoModule({ fetchFn: fakeFetch, mailerFor: () => (mailOn ? gateMail : null) }),
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

let visitorA = '';
let visitorB = '';
let businessesA: number[] = [];
let businessesB: number[] = [];

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] });
  const a = await enter('Dana Visitor', 'dana@example.com');
  expect(a.status).toBe(303);
  visitorA = cookieOf(a);
  const b = await enter('Avi Visitor', 'avi@example.com', { consent: true });
  visitorB = cookieOf(b);
  const me = async (cookie: string) => ((await (await call('/api/me', { cookie })).json()) as any).user.businesses.map((x: any) => x.id) as number[];
  businessesA = await me(visitorA);
  businessesB = await me(visitorB);
}, 120_000);

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
    expect(html).toContain('name="consent" value="yes"');
    expect(html).not.toMatch(/name="consent"[^>]*checked/);
    expect(html).toContain('data-sitekey="1x00000000000000000000AA"');
    expect(html).toContain('Send me updates and offers from Sample Sender by email.');
    expect(html).toContain('href="/privacy?lang=en"');
    expect(await (await call('/privacy?lang=he')).text()).toContain('הודעת פרטיות');
    expect((await call('/api/me')).status).toBe(401);
  });

  it('opens in Hebrew by default and remembers the language for the app', async () => {
    const html = await (await call('/')).text();
    expect(html).toContain('lang="he"');
    expect(html).toContain("localStorage.setItem('open-ledger-il-locale','he')");
    expect(await (await call('/privacy')).text()).toContain('הודעת פרטיות');
  });

  it('refuses a failed Turnstile check', async () => {
    turnstileOk = false;
    try {
      expect((await enter('Bot', 'bot@example.com')).status).toBe(400);
    } finally {
      turnstileOk = true;
    }
  });

  it('stores the lead, the consent record, forwards both with the secret, and sets a 24-hour HttpOnly cookie', async () => {
    const lead = (await first<any>(env.DB, "SELECT * FROM demo_leads WHERE email = 'avi@example.com'"))!;
    expect(lead.ip).toBe('198.51.100.7');
    const consent = (await first<any>(env.DB, 'SELECT * FROM demo_consents WHERE lead_id = ?', lead.id))!;
    expect(consent).toMatchObject({ consent: 1, text_version: '2026-10-13', confirmed_at: null });
    expect(consent.consent_text).toContain('Sample Sender');
    const sent = webhook.find((w) => w.body.email === 'avi@example.com')!;
    expect(sent.secret).toBe('lead-secret');
    expect(sent.body).toMatchObject({ event: 'lead', consent: 'yes', consentTextVersion: '2026-10-13' });
    expect(lead.webhook_status).toBe('saved');
    // Double opt-in: one confirmation email with a signed link.
    const mail = gateMail.sent.find((m) => m.to === 'avi@example.com')!;
    expect(mail.text).toContain('/api/demo/confirm/');
    expect(mail.text).toContain('/api/demo/unsubscribe/');
    const res = await enter('Someone', 'someone@example.com');
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly; Secure; SameSite=Lax; Max-Age=86400/);
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
    expect((await first<any>(env.DB, 'SELECT unsubscribed_at FROM demo_consents WHERE lead_id = ?', lead.id))!.unsubscribed_at).not.toBeNull();
    expect(webhook.some((w) => w.body.email === 'avi@example.com' && w.body.event === 'unsubscribe')).toBe(true);
    // The consent record never changes otherwise and never deletes.
    await expect(run(env.DB, 'DELETE FROM demo_consents WHERE lead_id = ?', lead.id)).rejects.toThrow(/append.only/);
    await expect(run(env.DB, 'UPDATE demo_consents SET consent = 0 WHERE lead_id = ?', lead.id)).rejects.toThrow(/append.only/);
  });

  it('the same email the same day reopens the same sandbox: this browser at once, another after an email code', async () => {
    const before = (await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM demo_sandboxes'))!.n;
    const same = await enter('Dana Visitor', 'dana@example.com', { cookie: visitorA });
    expect(same.status).toBe(303);
    const other = await enter('Dana Visitor', 'dana@example.com');
    expect(other.status).toBe(200);
    expect(await other.text()).toContain('Welcome back');
    const code = /(\d{6})/.exec(gateMail.sent[gateMail.sent.length - 1]!.text)![1]!;
    const wrong = await call('/api/demo/verify', { method: 'POST', body: new URLSearchParams({ email: 'dana@example.com', code: code === '000000' ? '111111' : '000000' }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(wrong.status).toBe(400);
    const ok = await call('/api/demo/verify', { method: 'POST', body: new URLSearchParams({ email: 'dana@example.com', code }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(ok.status).toBe(303);
    const ids = ((await (await call('/api/me', { cookie: cookieOf(ok) })).json()) as any).user.businesses.map((x: any) => x.id);
    expect(ids).toEqual(businessesA);
    expect((await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM demo_sandboxes'))!.n).toBe(before);
  });
});

describe('sandboxes', () => {
  it('a visitor owns two sandbox businesses and never reads another sandbox or a master', async () => {
    expect(businessesA).toHaveLength(2);
    expect(businessesA.some((id) => businessesB.includes(id))).toBe(false);
    const masters = (await all<{ business_id: number }>(env.DB, 'SELECT business_id FROM demo_master_businesses')).map((r) => r.business_id);
    for (const other of [...businessesB, ...masters, 1]) expect((await call('/api/documents', { cookie: visitorA, business: other })).status).toBe(403);
    const docB = (await first<{ id: number }>(env.DB, 'SELECT id FROM documents WHERE business_id = ? LIMIT 1', businessesB[0]))!.id;
    expect((await call(`/api/documents/${docB}`, { cookie: visitorA, business: businessesA[0] })).status).toBe(404);
    expect((await call(`/api/documents/${docB}`, { method: 'DELETE', cookie: visitorA, business: businessesA[0] })).status).toBe(404);
  });

  it('keeps the Ledger locks: a final document only cancels or credits, never deletes', async () => {
    const final = (await first<{ id: number }>(env.DB, "SELECT id FROM documents WHERE business_id = ? AND status = 'final' AND type = '400' LIMIT 1", businessesA[0]))!.id;
    expect((await call(`/api/documents/${final}`, { method: 'DELETE', cookie: visitorA, business: businessesA[0] })).status).toBe(409);
    expect((await first<{ status: string }>(env.DB, 'SELECT status FROM documents WHERE id = ?', final))!.status).toBe('final');
    const draft = await call('/api/documents', { method: 'POST', cookie: visitorA, business: businessesA[0], body: JSON.stringify({ type: 'QT', lines: [{ description: 'Demo work', unitPriceMinor: 10000 }] }) });
    expect(draft.status).toBe(201);
    const id = ((await draft.json()) as any).document.id;
    expect((await call(`/api/documents/${id}`, { method: 'DELETE', cookie: visitorA, business: businessesA[0] })).status).toBeLessThan(300);
  });

  it('settings are read-only, except Add a business and the switch to עוסק מורשה', async () => {
    const put = await call('/api/ops/business', { method: 'PUT', cookie: visitorA, business: businessesA[0], body: JSON.stringify({ nameEn: 'Hacked' }) });
    expect(put.status).toBe(403);
    expect(((await put.json()) as any).error.message).toContain('Demo: settings are read-only');
    expect((await call('/api/contracts/templates', { method: 'POST', cookie: visitorA, business: businessesA[0], body: '{}' })).status).toBe(403);
    expect((await call('/api/access/users', { method: 'POST', cookie: visitorA, business: businessesA[0], body: '{}' })).status).toBe(403);
    expect((await call('/api/ops/business', { cookie: visitorA, business: businessesA[0] })).status).toBe(200);
    const sw = await call('/api/legal-mode/switch', { method: 'POST', cookie: visitorA, business: businessesA[0], body: JSON.stringify({ kind: 'becoming', effectiveDate: '2099-01-01' }) });
    expect(sw.status).not.toBe(403);
    const add = await call('/api/businesses', { method: 'POST', cookie: visitorA, business: businessesA[0], body: JSON.stringify({ entityType: 'company', nameEn: 'Visitor Co Ltd', nameHe: 'חברת מבקר', taxId: '599999950', addressEn: 'Haifa' }) });
    expect(add.status).toBe(201);
    // At most 3 businesses per sandbox.
    const fourth = await call('/api/businesses', { method: 'POST', cookie: visitorA, business: businessesA[0], body: JSON.stringify({ entityType: 'company', nameEn: 'Fourth Ltd', nameHe: 'רביעית', taxId: '599999968', addressEn: 'Haifa' }) });
    expect(fourth.status).toBe(429);
  });
});

describe('caps', () => {
  it('stops new documents at the daily cap with a plain message, and alerts Slack once', async () => {
    const capped = { ...env, DEMO_CAP_DOCUMENTS: '1' } as Env;
    const body = JSON.stringify({ type: 'QT', lines: [{ description: 'Cap test', unitPriceMinor: 100 }] });
    slack.length = 0;
    let res = await call('/api/documents', { method: 'POST', cookie: visitorB, business: businessesB[0], body }, capped);
    if (res.status === 201) res = await call('/api/documents', { method: 'POST', cookie: visitorB, business: businessesB[0], body }, capped);
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).error.code).toBe('demo_cap');
    await call('/api/documents', { method: 'POST', cookie: visitorB, business: businessesB[0], body }, capped);
    // The guard's Slack goes through the global fetch. Count the alert rows instead.
    expect((await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM demo_usage WHERE kind = 'documents' AND alerted_at IS NOT NULL"))!.n).toBe(1);
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
    const doc = (await first<{ id: number }>(env.DB, 'SELECT id FROM documents WHERE business_id = ? LIMIT 1', businessesA[0]))!.id;
    const preview = await call(`/api/pdf/documents/${doc}?variant=client`, { cookie: visitorA, business: businessesA[0] });
    expect(await preview.text()).toContain('ledger-demo-watermark');
  });

  it('the Tax Authority is fake: connect at once, DEMO- numbers, never a network call', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const company = businessesB[1]!;
    const connect = await call('/api/ita/connect', { cookie: visitorB, business: company, redirect: 'manual' });
    const location = connect.headers.get('location') ?? '';
    expect(location).toMatch(/\/api\/ita\/callback\?code=demo/);
    const callback = await call(new URL(location, 'https://sample.test').pathname + new URL(location, 'https://sample.test').search, { cookie: visitorB, business: company, redirect: 'manual' });
    expect(callback.status).toBeLessThan(400);
    const client = ((await (await call('/api/clients', { cookie: visitorB, business: company })).json()) as any).clients.find((c: any) => c.name_en === 'Example Tech Ltd');
    const draft = await call('/api/documents', { method: 'POST', cookie: visitorB, business: company, body: JSON.stringify({ type: '305', clientId: client.id, lines: [{ description: 'Large project', unitPriceMinor: 2000000 }] }) });
    const id = ((await draft.json()) as any).document.id;
    const fin = await call(`/api/documents/${id}/finalize`, { method: 'POST', cookie: visitorB, business: company, body: '{}' });
    expect(fin.status).toBeLessThan(300);
    const row = (await first<{ status: string; allocation_number: string | null }>(env.DB, 'SELECT status, allocation_number FROM documents WHERE id = ?', id))!;
    if (row.status === 'final') expect(row.allocation_number).toMatch(/^DEMO-\d{9}$/);
    else expect(row.status).toBe('allocation_refused');
    const taxCalls = spy.mock.calls.filter(([u]) => /taxes\.gov\.il/.test(String(u instanceof Request ? u.url : u)));
    expect(taxCalls).toEqual([]);
  });

  it('client email goes to the outbox as a preview, and the contract code shows on screen', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const biz = businessesA[0]!;
    const template = ((await (await call('/api/contracts/templates', { cookie: visitorA, business: biz })).json()) as any).templates.find((t: any) => t.name === 'Service Agreement');
    const client = ((await (await call('/api/clients', { cookie: visitorA, business: biz })).json()) as any).clients[0];
    const created = await call('/api/contracts', { method: 'POST', cookie: visitorA, business: biz, body: JSON.stringify({ clientId: client.id, templateId: template.id, values: {}, signer: { name: 'Test Signer', email: 'signer@example.com' } }) });
    const contractId = ((await created.json()) as any).contract.id;
    const sent = await call(`/api/contracts/${contractId}/send`, { method: 'POST', cookie: visitorA, business: biz, body: JSON.stringify({ channel: 'email' }) });
    expect(sent.status).toBe(200);
    const outbox = ((await (await call('/api/demo-app/outbox', { cookie: visitorA, business: biz })).json()) as any).emails;
    expect(outbox[0].to_addr).toBe('signer@example.com');
    expect(spy.mock.calls.filter(([u]) => /resend\.com/.test(String(u)))).toEqual([]);
    const url = ((await sent.json()) as any).url.replace('https://sample.test', '');
    const code = await call(`${url}/code`, { method: 'POST' });
    expect(((await code.json()) as any).demoCode).toMatch(/^\d{6}$/);
    expect(engine.renders[engine.renders.length - 1]).toContain('ledger-demo-watermark');
  });

  it('a receipt upload gets the fixed sample reading, labelled demo', async () => {
    const { DEMO_EXTRACTION } = await import('../../../src/modules/expenses/extractor');
    const { AiExtractor } = await import('../../../src/modules/expenses/extractor');
    const result = await new AiExtractor({ ...env, DEMO_MODE: '1' } as Env).extract({ bytes: new ArrayBuffer(4), contentType: 'image/png', filename: 'r.png' });
    expect(result).toEqual(DEMO_EXTRACTION());
    expect(result.documentType).toContain('Demo');
  });
});

describe('admin', () => {
  it('needs an Access JWT for an admin email', async () => {
    expect((await call('/admin')).status).toBe(403);
    expect((await call('/admin', { headers: { 'Cf-Access-Jwt-Assertion': await adminJwt('someone@example.com') } })).status).toBe(403);
    expect((await call('/api/admin/summary')).status).toBe(403);
    const page = await call('/admin', { headers: { 'Cf-Access-Jwt-Assertion': await adminJwt('admin@example.com') } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Reset sandboxes now');
  });

  it('shows totals, exports the leads as CSV, and opens the sample set with settings unlocked', async () => {
    const h = { 'Cf-Access-Jwt-Assertion': await adminJwt('admin@example.com') };
    const summary = (await (await call('/admin/api/summary', { headers: h })).json()) as any;
    expect(summary.leads).toBeGreaterThanOrEqual(3);
    expect(summary.sandboxesToday).toBeGreaterThanOrEqual(2);
    const csv = await (await call('/admin/api/leads.csv', { headers: h })).text();
    expect(csv.split('\n')[0]).toBe('name,email,first_visit_at,last_visit_at,visits,marketing_consent,confirmed_at,unsubscribed_at,webhook_status');
    expect(csv).toContain('dana@example.com');
    const session = await call('/admin/api/sample-session', { method: 'POST', headers: h });
    const adminCookie = cookieOf(session);
    const masters = (await all<{ business_id: number }>(env.DB, 'SELECT business_id FROM demo_master_businesses')).map((r) => r.business_id);
    const put = await call('/api/ops/business', { method: 'PUT', cookie: adminCookie, business: masters[0], body: JSON.stringify({ phone: '050-0000001' }) });
    expect(put.status).not.toBe(403);
    expect((await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'demo.admin_write'"))!.n).toBeGreaterThan(0);
  });
});
