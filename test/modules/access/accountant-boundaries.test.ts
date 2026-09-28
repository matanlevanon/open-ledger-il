import { Hono } from 'hono';
import { env } from 'cloudflare:workers';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { requireFeature, requireRole } from '../../../src/core/auth';
import { run } from '../../../src/core/db';
import type { ModuleDef } from '../../../src/core/module';
import type { AppEnv, Env } from '../../../src/env';
import { createApp } from '../../../src/index';

/**
 * runs/R09-accountant.md Tests: "Accountant blocked from issue, cancel, credit, settings, ITA
 * routes." Those modules (R01, R14, R12) are built by other runs and are not in this branch yet,
 * so this stands in with the same feature declarations they are documented to use
 * (docs/architecture.md, src/core/auth.ts OWNER_ONLY_FEATURES) and proves the boundary holds for
 * a fully-featured accountant, not just one missing a switch.
 */
const TEAM = 'https://test-team.cloudflareaccess.com';
const AUD = 'test-aud';
let privateKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

async function token(email: string) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(TEAM)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

const future = new Hono<AppEnv>();
future.post('/documents/issue', requireFeature('issue_documents'), (c) => c.json({ ok: true }));
future.post('/documents/:id/cancel', requireFeature('issue_documents'), (c) => c.json({ ok: true }));
future.post('/documents/:id/credit', requireFeature('issue_documents'), (c) => c.json({ ok: true }));
future.get('/settings', requireRole('owner'), (c) => c.json({ ok: true }));
future.get('/ita/status', requireFeature('ita'), (c) => c.json({ ok: true }));
const futureModule: ModuleDef = { name: 'future', basePath: '/future', routes: future };

function app() {
  return createApp({ auth: { keyResolver: () => jwks }, modules: [futureModule] });
}

async function call(path: string, email: string, method = 'GET') {
  const headers = { 'Cf-Access-Jwt-Assertion': await token(email) };
  return app().request(`/api${path}`, { method, headers }, { ...env, DEV_AUTH_EMAIL: undefined } as Env);
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  jwks = createLocalJWKSet({ keys: [jwk] });

  await run(env.DB, `INSERT OR IGNORE INTO users (email, role) VALUES ('owner-b@example.com', 'owner')`);
  const cpa = await run(
    env.DB,
    `INSERT INTO users (email, role, access_ends_on) VALUES ('cpa-b@example.com', 'accountant', '2030-01-01')`,
  );
  // Every switch on: even the most generous accountant never reaches these.
  for (const feature of [
    'income_documents',
    'expenses',
    'clients',
    'reports',
    'monthly_pack',
    'unified_file',
    'pcn874',
    'bank_matches',
    'notes',
  ]) {
    await run(env.DB, `INSERT INTO user_features (user_id, feature, enabled) VALUES (?, ?, 1)`, cpa.lastRowId, feature);
  }
});

describe('accountant boundaries', () => {
  for (const [path, method] of [
    ['/future/documents/issue', 'POST'],
    ['/future/documents/1/cancel', 'POST'],
    ['/future/documents/1/credit', 'POST'],
    ['/future/settings', 'GET'],
    ['/future/ita/status', 'GET'],
  ] as const) {
    it(`refuses the accountant on ${method} ${path}`, async () => {
      expect((await call(path, 'cpa-b@example.com', method)).status).toBe(403);
    });

    it(`lets the owner through ${method} ${path}`, async () => {
      expect((await call(path, 'owner-b@example.com', method)).status).toBe(200);
    });
  }
});
