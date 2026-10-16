import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/index';
import { checkMcpToken, LAST_USED_EVERY_MS, makeMcpToken, setMcpEnabled } from '../../../src/modules/mcp/tokens';
import { OWNER_ACTOR } from '../../helpers';

/**
 * R34 task 2: the token made in Settings > MCP. Once it exists only it works, the installer's
 * MCP_TOKEN stops. Off refuses everything. Every refusal has the same 401 body.
 */
const SECRET = 'installer-secret-token';
const app = createApp();
const testEnv = { ...env, MCP_TOKEN: SECRET };

async function ping(token: string | null, e: Record<string, unknown> = testEnv) {
  return app.request(
    '/mcp',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token !== null ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    },
    e,
  );
}

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM mcp_tokens'),
    env.DB.prepare("UPDATE settings SET value = '1' WHERE key = 'mcp.enabled'"),
  ]);
});

describe('MCP auth with a Ledger token (R34)', () => {
  it('accepts the Worker secret while no Ledger token exists', async () => {
    expect((await ping(SECRET)).status).toBe(200);
  });

  it('accepts the Ledger token and refuses the Worker secret once it exists', async () => {
    const made = await makeMcpToken(env.DB, OWNER_ACTOR);
    expect(made.token).toMatch(/^olil_[A-Za-z0-9_-]{43}$/);
    expect((await ping(made.token)).status).toBe(200);
    expect((await ping(SECRET)).status).toBe(401);
  });

  it('refuses a revoked token: making a second leaves one active row and the first stops', async () => {
    const one = await makeMcpToken(env.DB, OWNER_ACTOR);
    const two = await makeMcpToken(env.DB, OWNER_ACTOR);
    const active = await env.DB.prepare('SELECT COUNT(*) AS n FROM mcp_tokens WHERE revoked_at IS NULL').first<{ n: number }>();
    expect(active!.n).toBe(1);
    expect((await ping(one.token)).status).toBe(401);
    expect((await ping(two.token)).status).toBe(200);
  });

  it('refuses both tokens when MCP is off', async () => {
    await setMcpEnabled(env.DB, OWNER_ACTOR, false);
    expect((await ping(SECRET)).status).toBe(401);
    const made = await makeMcpToken(env.DB, OWNER_ACTOR);
    expect((await ping(made.token)).status).toBe(401);
    await setMcpEnabled(env.DB, OWNER_ACTOR, true);
    expect((await ping(made.token)).status).toBe(200);
  });

  it('answers the same 401 body for every failure', async () => {
    const bodies: string[] = [];
    bodies.push(await (await ping(null)).text());
    bodies.push(await (await ping('wrong')).text());
    bodies.push(await (await ping(SECRET, { ...env, MCP_TOKEN: undefined })).text());
    const made = await makeMcpToken(env.DB, OWNER_ACTOR);
    bodies.push(await (await ping(SECRET)).text());
    await makeMcpToken(env.DB, OWNER_ACTOR);
    bodies.push(await (await ping(made.token)).text());
    await setMcpEnabled(env.DB, OWNER_ACTOR, false);
    bodies.push(await (await ping(SECRET)).text());
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('A valid bearer token is required.');
  });

  it('writes last_used_at at most once an hour', async () => {
    const made = await makeMcpToken(env.DB, OWNER_ACTOR);
    const lastUsed = async () => (await env.DB.prepare('SELECT last_used_at FROM mcp_tokens WHERE id = ?').bind(made.id).first<{ last_used_at: string | null }>())!.last_used_at;
    expect(await lastUsed()).toBeNull();
    const t0 = new Date('2026-10-16T10:00:00.000Z');
    expect(await checkMcpToken(env.DB, SECRET, made.token, t0)).toBe(true);
    expect(await lastUsed()).toBe(t0.toISOString());
    const t1 = new Date(t0.getTime() + LAST_USED_EVERY_MS - 1000);
    expect(await checkMcpToken(env.DB, SECRET, made.token, t1)).toBe(true);
    expect(await lastUsed()).toBe(t0.toISOString());
    const t2 = new Date(t0.getTime() + LAST_USED_EVERY_MS);
    expect(await checkMcpToken(env.DB, SECRET, made.token, t2)).toBe(true);
    expect(await lastUsed()).toBe(t2.toISOString());
  });

  it('keeps the plain token out of D1 and the audit log', async () => {
    const made = await makeMcpToken(env.DB, OWNER_ACTOR);
    await makeMcpToken(env.DB, OWNER_ACTOR);
    const tokens = await env.DB.prepare('SELECT * FROM mcp_tokens').all();
    const audit = await env.DB.prepare("SELECT * FROM audit_log WHERE action LIKE 'mcp.%'").all();
    const settings = await env.DB.prepare('SELECT * FROM settings').all();
    const dump = JSON.stringify([tokens.results, audit.results, settings.results]);
    expect(dump).not.toContain(made.token);
    expect(dump).not.toContain(made.token.slice(5));
    expect(audit.results.some((r) => r.action === 'mcp.token_create' && String(r.details).includes(made.last4))).toBe(true);
    expect(audit.results.some((r) => r.action === 'mcp.token_revoke' && String(r.details).includes(made.last4))).toBe(true);
  });
});
