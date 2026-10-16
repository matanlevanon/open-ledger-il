import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/index';
import { createExpensesModule } from '../../../src/modules/expenses';
import { FakeDriveSource, FakeExtractor } from '../../../src/modules/expenses/fakes';
import { hmacHex, INBOX_KEYS } from '../../../src/modules/expenses/inbox';
import type { Deps } from '../../../src/modules/expenses/service';
import { FakeFxHistory, FxRates } from '../../../src/modules/fx';

/** R35 task 4: /api/expenses/settings/inbox. Owner only, never in the demo, rotate through the gateway. */

const SECRET = 'inbox-settings-secret';
const ASSISTANT = 'noauto-inbox-settings-assistant@example.com';
const ACCOUNTANT = 'inbox-settings-cpa@example.com';
const gatewayCalls: { url: string; body: string; signature: string | null }[] = [];
let gatewayStatus = 200;
const gatewayFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  gatewayCalls.push({ url: String(input), body: String(init?.body), signature: new Headers(init?.headers).get('X-Inbox-Signature') });
  return gatewayStatus === 200 ? Response.json({ inboxId: 'newid00000', address: 'newid00000@in.example.test' }) : new Response('{}', { status: gatewayStatus });
}) as typeof fetch;
const deps: Deps = { drive: new FakeDriveSource(), extractor: new FakeExtractor(), fx: new FxRates(env.DB, new FakeFxHistory({})), gatewayFetch };
const app = createApp({ modules: [createExpensesModule(() => deps)] });
const testEnv = { ...env, INBOX_SECRET: SECRET, OWNER_EMAIL: 'owner@example.com' };

const call = (method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) =>
  app.request(`/api/expenses/settings/inbox${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, { ...testEnv, ...extra });

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO users (email, role) VALUES (?, 'accountant')").bind(ACCOUNTANT),
    env.DB.prepare("INSERT OR IGNORE INTO user_features (user_id, feature, enabled) SELECT id, 'expenses', 1 FROM users WHERE email = ?").bind(ACCOUNTANT),
    env.DB.prepare("INSERT OR IGNORE INTO users (email, role) VALUES (?, 'owner')").bind(ASSISTANT),
    env.DB.prepare("INSERT OR IGNORE INTO user_businesses (user_id, business_id, role) SELECT id, 1, 'assistant' FROM users WHERE email = ?").bind(ASSISTANT),
  ]);
});

beforeEach(async () => {
  gatewayCalls.length = 0;
  gatewayStatus = 200;
  await env.DB.prepare('DELETE FROM settings WHERE key LIKE ?').bind('expenses.inbox_%').run();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind(INBOX_KEYS.id, 'oldid00000'),
    env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind(INBOX_KEYS.address, 'oldid00000@in.example.test'),
    env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind(INBOX_KEYS.gateway, 'https://gw.example.test'),
  ]);
});

describe('GET /api/expenses/settings/inbox', () => {
  it('shows the address, on by default, the default senders, and no Gmail code', async () => {
    const res = await call('GET', '');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ configured: true, address: 'oldid00000@in.example.test', enabled: true, gmail: null, canRotate: true });
    expect(body.senders).toEqual(expect.arrayContaining(['owner@example.com', ASSISTANT]));
  });

  it('is not configured without INBOX_SECRET', async () => {
    const body = (await (await call('GET', '', undefined, { INBOX_SECRET: undefined })).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ configured: false, canRotate: false });
  });
});

describe('changes', () => {
  it('saves the senders list and the switch, audited', async () => {
    const res = await call('PUT', '/senders', { senders: ['A@Example.com', 'b@example.com', 'a@example.com'] });
    expect(await res.json()).toEqual({ senders: ['a@example.com', 'b@example.com'] });
    expect((await call('PUT', '/senders', { senders: ['not an email'] })).status).toBe(400);
    expect(await (await call('PUT', '/enabled', { enabled: false })).json()).toEqual({ enabled: false });
    const body = (await (await call('GET', '')).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ enabled: false, senders: ['a@example.com', 'b@example.com'] });
    const audit = await env.DB.prepare("SELECT action FROM audit_log WHERE action IN ('inbox.senders', 'inbox.enabled')").all<{ action: string }>();
    expect(audit.results.map((r) => r.action)).toEqual(expect.arrayContaining(['inbox.senders', 'inbox.enabled']));
  });

  it('rotate asks the gateway with a signed body and stores the new address', async () => {
    const res = await call('POST', '/rotate');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { address: string }).address).toBe('newid00000@in.example.test');
    expect(gatewayCalls).toHaveLength(1);
    const { url, body, signature } = gatewayCalls[0]!;
    expect(url).toBe('https://gw.example.test/rotate');
    const sent = JSON.parse(body) as { inboxId: string; timestamp: number };
    expect(sent.inboxId).toBe('oldid00000');
    expect(signature).toBe(await hmacHex(SECRET, `${sent.timestamp}.${body}`));
    const stored = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(INBOX_KEYS.id).first<{ value: string }>();
    expect(stored!.value).toBe('newid00000');
  });

  it('a refused rotate keeps the old address', async () => {
    gatewayStatus = 401;
    expect((await call('POST', '/rotate')).status).toBe(502);
    const stored = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(INBOX_KEYS.address).first<{ value: string }>();
    expect(stored!.value).toBe('oldid00000@in.example.test');
  });
});

describe('who may use it', () => {
  it('refuses the assistant and the accountant, and the demo', async () => {
    // Both can open Expenses, so a 403 here comes from the owner check.
    expect((await app.request('/api/expenses', {}, { ...testEnv, DEV_AUTH_EMAIL: ASSISTANT })).status).toBe(200);
    expect((await app.request('/api/expenses', {}, { ...testEnv, DEV_AUTH_EMAIL: ACCOUNTANT })).status).toBe(200);
    for (const email of [ASSISTANT, ACCOUNTANT]) {
      expect((await call('GET', '', undefined, { DEV_AUTH_EMAIL: email })).status).toBe(403);
      expect((await call('PUT', '/enabled', { enabled: false }, { DEV_AUTH_EMAIL: email })).status).toBe(403);
      expect((await call('POST', '/rotate', undefined, { DEV_AUTH_EMAIL: email })).status).toBe(403);
    }
    expect((await call('GET', '', undefined, { DEMO_MODE: '1' })).status).not.toBe(200);
    expect(gatewayCalls).toHaveLength(0);
  });
});
