import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../src/core/errors';
import type { AppEnv } from '../../../src/env';
import { createApp } from '../../../src/index';
import { createMcpSettingsModule } from '../../../src/modules/mcp/settings-routes';

/** R34 task 3: /api/settings/mcp. Owner only, 403 in the demo, audited with the last 4 only. */
const app = createApp();
const OWNER = 'owner@example.com';
const ASSISTANT = 'mcp-assistant@example.com';
const ACCOUNTANT = 'mcp-accountant@example.com';

const as = (email: string, extra: Record<string, unknown> = {}) => ({ ...env, DEV_AUTH_EMAIL: email, MCP_TOKEN: 'installer-secret', PUBLIC_APP_URL: 'https://ledger.example.com', ...extra });

function call(email: string, method: string, path: string, body?: unknown, extra?: Record<string, unknown>) {
  return app.request(
    `/api/settings/mcp${path}`,
    { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) },
    as(email, extra),
  );
}

function mcpPing(token: string) {
  return app.request(
    '/mcp',
    { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) },
    as(OWNER),
  );
}

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO users (email, role) VALUES (?, 'assistant')").bind(ASSISTANT),
    env.DB.prepare("INSERT OR IGNORE INTO users (email, role) VALUES (?, 'accountant')").bind(ACCOUNTANT),
  ]);
});

afterEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM mcp_tokens'), env.DB.prepare("UPDATE settings SET value = '1' WHERE key = 'mcp.enabled'")]);
});

describe('GET /api/settings/mcp', () => {
  it('shows the address, on, and the installer token before any Ledger token', async () => {
    const res = await call(OWNER, 'GET', '');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ address: 'https://ledger.example.com/mcp', enabled: true, token: { state: 'installer' } });
  });

  it('says none when neither token is set', async () => {
    const body = (await (await call(OWNER, 'GET', '', undefined, { MCP_TOKEN: undefined })).json()) as { token: { state: string } };
    expect(body.token).toEqual({ state: 'none' });
  });
});

describe('POST /api/settings/mcp/token', () => {
  it('returns the token once, then GET shows only its last 4', async () => {
    const res = await call(OWNER, 'POST', '/token');
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const { token, last4 } = (await res.json()) as { token: string; last4: string };
    expect(token).toMatch(/^olil_/);
    expect(last4).toBe(token.slice(-4));
    const state = (await (await call(OWNER, 'GET', '')).json()) as { token: Record<string, unknown> };
    expect(state.token).toMatchObject({ state: 'ledger', last4, createdBy: OWNER, lastUsedAt: null });
    expect(JSON.stringify(state)).not.toContain(token);
    expect((await mcpPing(token)).status).toBe(200);
    expect((await mcpPing('installer-secret')).status).toBe(401);
  });

  it('making a token twice leaves one active row, and the first stops working', async () => {
    const first = ((await (await call(OWNER, 'POST', '/token')).json()) as { token: string }).token;
    const second = ((await (await call(OWNER, 'POST', '/token')).json()) as { token: string }).token;
    const rows = await env.DB.prepare('SELECT revoked_at, revoked_by FROM mcp_tokens ORDER BY id').all<{ revoked_at: string | null; revoked_by: string | null }>();
    expect(rows.results.filter((r) => r.revoked_at === null)).toHaveLength(1);
    expect(rows.results[0]!.revoked_by).toBe(OWNER);
    expect((await mcpPing(first)).status).toBe(401);
    expect((await mcpPing(second)).status).toBe(200);
    const audit = await env.DB.prepare("SELECT action, details FROM audit_log WHERE action LIKE 'mcp.token%'").all<{ action: string; details: string }>();
    const dump = JSON.stringify(audit.results);
    expect(dump).not.toContain(first);
    expect(dump).not.toContain(second);
    expect(audit.results.some((r) => r.action === 'mcp.token_revoke' && r.details.includes(first.slice(-4)))).toBe(true);
  });
});

describe('POST /api/settings/mcp/enabled', () => {
  it('turns MCP off and on, audited', async () => {
    const off = await call(OWNER, 'POST', '/enabled', { enabled: false });
    expect(await off.json()).toEqual({ enabled: false });
    expect((await mcpPing('installer-secret')).status).toBe(401);
    expect(((await (await call(OWNER, 'GET', '')).json()) as { enabled: boolean }).enabled).toBe(false);
    await call(OWNER, 'POST', '/enabled', { enabled: true });
    expect((await mcpPing('installer-secret')).status).toBe(200);
    const audit = await env.DB.prepare("SELECT action FROM audit_log WHERE action IN ('mcp.enable', 'mcp.disable')").all<{ action: string }>();
    expect(audit.results.map((r) => r.action)).toEqual(expect.arrayContaining(['mcp.enable', 'mcp.disable']));
  });

  it('refuses a body without a boolean', async () => {
    expect((await call(OWNER, 'POST', '/enabled', { enabled: 'yes' })).status).toBe(400);
  });
});

describe('who may use Settings > MCP', () => {
  it('refuses the assistant and the accountant on all three routes', async () => {
    for (const email of [ASSISTANT, ACCOUNTANT]) {
      expect((await call(email, 'GET', '')).status).toBe(403);
      expect((await call(email, 'POST', '/token')).status).toBe(403);
      expect((await call(email, 'POST', '/enabled', { enabled: false })).status).toBe(403);
    }
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM mcp_tokens').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('refuses an owner in the demo on all three routes', async () => {
    const h = new Hono<AppEnv>();
    h.use('*', async (c, next) => {
      c.set('user', { id: 1, email: OWNER, name: null, role: 'owner', features: [], theme: null, locale: null, businessId: 1, businesses: [{ id: 1, role: 'owner' }] });
      await next();
    });
    h.route('/', createMcpSettingsModule().routes);
    h.onError((err, c) => c.json({}, err instanceof ForbiddenError ? 403 : 500));
    const demoEnv = { ...env, DEMO_MODE: '1' };
    expect((await h.request('/', {}, demoEnv)).status).toBe(403);
    expect((await h.request('/token', { method: 'POST' }, demoEnv)).status).toBe(403);
    expect((await h.request('/enabled', { method: 'POST', body: '{"enabled":false}' }, demoEnv)).status).toBe(403);
    // The same app without demo mode lets the owner in.
    expect((await h.request('/', {}, { ...env, DEMO_MODE: '' })).status).toBe(200);
  });
});
