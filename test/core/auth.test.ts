import { Hono } from 'hono';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { hasFeature, requireFeature, requireRole } from '../../src/core/auth';
import { all, run } from '../../src/core/db';
import type { ModuleDef } from '../../src/core/module';
import type { AppEnv, Env } from '../../src/env';
import { createApp } from '../../src/index';

const TEAM = 'https://test-team.cloudflareaccess.com';
const AUD = 'test-aud';

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

async function token(email: string, opts: { aud?: string; iss?: string; key?: CryptoKey; exp?: string | number } = {}) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? TEAM)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.key ?? privateKey);
}

// A test module with one route per kind of guard.
const probe = new Hono<AppEnv>();
probe.get('/income', requireFeature('income_documents'), (c) => c.json({ ok: true }));
probe.get('/bank', requireFeature('bank_matches'), (c) => c.json({ ok: true }));
probe.post('/issue', requireFeature('issue_documents'), (c) => c.json({ ok: true }));
probe.get('/settings', requireRole('owner'), (c) => c.json({ ok: true }));
const probeModule: ModuleDef = { name: 'probe', basePath: '/probe', routes: probe };

function app() {
  return createApp({ auth: { keyResolver: () => jwks, today: () => '2026-10-01' }, modules: [probeModule] });
}

async function call(path: string, init: { email?: string; jwt?: string; method?: string; body?: unknown; envOverride?: Partial<Env> } = {}) {
  const headers: Record<string, string> = { 'CF-Connecting-IP': '203.0.113.9' };
  if (init.jwt) headers['Cf-Access-Jwt-Assertion'] = init.jwt;
  else if (init.email) headers['Cf-Access-Jwt-Assertion'] = await token(init.email);
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await app().request(
    `/api${path}`,
    { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) },
    { ...env, DEV_AUTH_EMAIL: undefined, ...init.envOverride },
  );
  return res;
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  jwks = createLocalJWKSet({ keys: [jwk] });

  await run(env.DB, `INSERT OR IGNORE INTO users (email, role) VALUES ('boss@example.com', 'owner')`);
  const acc = await run(env.DB, `INSERT INTO users (email, role, access_ends_on) VALUES ('cpa@example.com', 'accountant', '2027-09-30')`);
  await run(env.DB, `INSERT INTO user_features (user_id, feature, enabled) VALUES (?, 'income_documents', 1), (?, 'bank_matches', 0)`, acc.lastRowId, acc.lastRowId);
  await run(env.DB, `INSERT INTO users (email, role, access_ends_on) VALUES ('old-cpa@example.com', 'accountant', '2026-09-30')`);
  await run(env.DB, `INSERT INTO users (email, role, active) VALUES ('off@example.com', 'accountant', 0)`);
});

describe('auth: Cloudflare Access JWT', () => {
  it('accepts a valid token and maps the email to the owner role', async () => {
    const res = await call('/me', { email: 'Boss@Example.com' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { role: string; features: string[]; theme: string | null; locale: string | null } };
    expect(body.user.role).toBe('owner');
    expect(body.user.features).toContain('settings');
    expect(body.user.theme).toBeNull();
    expect(body.user.locale).toBeNull();
  });

  it('refuses a missing token with 401', async () => {
    const res = await call('/me');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: 'unauthorized', message: 'Sign in to continue.' } });
  });

  it('refuses a token signed by another key, for another audience or issuer, or expired', async () => {
    for (const jwt of [
      await token('boss@example.com', { key: otherKey }),
      await token('boss@example.com', { aud: 'other-app' }),
      await token('boss@example.com', { iss: 'https://evil.cloudflareaccess.com' }),
      await token('boss@example.com', { exp: 946684800 }),
      'not-a-jwt',
    ]) {
      expect((await call('/me', { jwt })).status).toBe(401);
    }
  });

  it('fails closed when Access is not configured', async () => {
    const res = await call('/me', { email: 'boss@example.com', envOverride: { ACCESS_AUD: '' } });
    expect(res.status).toBe(401);
  });

  it('refuses unknown, disabled and expired users with 403', async () => {
    expect((await call('/me', { email: 'stranger@example.com' })).status).toBe(403);
    expect((await call('/me', { email: 'off@example.com' })).status).toBe(403);
    expect((await call('/me', { email: 'old-cpa@example.com' })).status).toBe(403);
  });
});

/** R16 tasks 15/16: theme and interface-language choice, remembered per user across devices. */
describe('auth: PATCH /me/preferences', () => {
  it('saves theme and locale, and GET /me reflects them afterward', async () => {
    const saved = await call('/me/preferences', { email: 'boss@example.com', method: 'PATCH', body: { theme: 'dark', locale: 'he' } });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ theme: 'dark', locale: 'he' });

    const me = await call('/me', { email: 'boss@example.com' });
    const body = (await me.json()) as { user: { theme: string | null; locale: string | null } };
    expect(body.user.theme).toBe('dark');
    expect(body.user.locale).toBe('he');
  });

  it('updates one field without touching the other', async () => {
    await call('/me/preferences', { email: 'boss@example.com', method: 'PATCH', body: { theme: 'light', locale: 'en' } });
    await call('/me/preferences', { email: 'boss@example.com', method: 'PATCH', body: { theme: 'dark' } });
    const me = await call('/me', { email: 'boss@example.com' });
    const body = (await me.json()) as { user: { theme: string | null; locale: string | null } };
    expect(body.user.theme).toBe('dark');
    expect(body.user.locale).toBe('en');
  });

  it('clears a preference back to null, falling back to system default', async () => {
    await call('/me/preferences', { email: 'boss@example.com', method: 'PATCH', body: { theme: 'dark' } });
    await call('/me/preferences', { email: 'boss@example.com', method: 'PATCH', body: { theme: null } });
    const me = await call('/me', { email: 'boss@example.com' });
    const body = (await me.json()) as { user: { theme: string | null } };
    expect(body.user.theme).toBeNull();
  });

  it('rejects an invalid value', async () => {
    const res = await call('/me/preferences', { email: 'boss@example.com', method: 'PATCH', body: { theme: 'purple' } });
    expect(res.status).toBe(400);
  });
});

describe('auth: dev bypass', () => {
  it('signs in as DEV_AUTH_EMAIL outside production', async () => {
    const res = await createApp({ modules: [] }).request('/api/me', {}, { ...env, ENVIRONMENT: 'development', DEV_AUTH_EMAIL: 'boss@example.com' });
    expect(res.status).toBe(200);
  });

  it('never bypasses in production', async () => {
    const res = await createApp({ modules: [] }).request('/api/me', {}, { ...env, ENVIRONMENT: 'production', DEV_AUTH_EMAIL: 'boss@example.com' });
    expect(res.status).toBe(401);
  });
});

describe('auth: owner bootstrap', () => {
  it('creates the owner on first sign-in of OWNER_EMAIL only while no owner exists', async () => {
    // An owner already exists (boss@example.com), so a new OWNER_EMAIL gets no row.
    const res = await call('/me', { email: 'new-owner@example.com', envOverride: { OWNER_EMAIL: 'new-owner@example.com' } });
    expect(res.status).toBe(403);
  });
});

describe('auth: roles and features', () => {
  it('lets the owner through every guard', async () => {
    for (const path of ['/probe/income', '/probe/bank', '/probe/settings']) {
      expect((await call(path, { email: 'boss@example.com' })).status).toBe(200);
    }
    expect((await call('/probe/issue', { email: 'boss@example.com', method: 'POST' })).status).toBe(200);
  });

  it('lets the accountant use enabled features only', async () => {
    expect((await call('/probe/income', { email: 'cpa@example.com' })).status).toBe(200);
    expect((await call('/probe/bank', { email: 'cpa@example.com' })).status).toBe(403);
  });

  it('never lets the accountant issue documents or open settings', async () => {
    await run(env.DB, `INSERT OR REPLACE INTO user_features (user_id, feature, enabled) SELECT id, 'issue_documents', 1 FROM users WHERE email = 'cpa@example.com'`);
    expect((await call('/probe/issue', { email: 'cpa@example.com', method: 'POST' })).status).toBe(403);
    expect((await call('/probe/settings', { email: 'cpa@example.com' })).status).toBe(403);
  });

  it('writes every accountant request to audit_log, allowed or refused', async () => {
    await call('/probe/income', { email: 'cpa@example.com' });
    await call('/probe/bank', { email: 'cpa@example.com' });
    const rows = await all<{ entity_id: string; details: string; ip: string; user_email: string }>(
      env.DB,
      `SELECT entity_id, details, ip, user_email FROM audit_log WHERE action = 'request' AND user_email = 'cpa@example.com'`,
    );
    const paths = rows.map((r) => `${r.entity_id} ${JSON.parse(r.details).status}`);
    expect(paths).toContain('/api/probe/income 200');
    expect(paths).toContain('/api/probe/bank 403');
    expect(rows[0]?.ip).toBe('203.0.113.9');
  });

  it('exposes the declared feature on the middleware', () => {
    expect(requireFeature('reports').feature).toBe('reports');
    expect(requireRole('owner').roles).toEqual(['owner']);
    expect(hasFeature({ id: 1, email: 'a', name: null, role: 'accountant', features: ['reports'], theme: null, locale: null }, 'reports')).toBe(true);
    expect(hasFeature({ id: 1, email: 'a', name: null, role: 'accountant', features: ['reports'], theme: null, locale: null }, 'ita')).toBe(false);
  });
});

describe('errors', () => {
  it('returns {error:{code,message}} for unknown API routes', async () => {
    const res = await call('/nope', { email: 'boss@example.com' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'No such endpoint.' } });
  });
});
