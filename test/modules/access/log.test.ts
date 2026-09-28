import { env } from 'cloudflare:workers';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { createApp } from '../../../src/index';
import type { Env } from '../../../src/env';

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

function app() {
  return createApp({ auth: { keyResolver: () => jwks } });
}

async function get(path: string, email: string) {
  return app().request(`/api${path}`, { headers: { 'Cf-Access-Jwt-Assertion': await token(email) } }, {
    ...env,
    DEV_AUTH_EMAIL: undefined,
  } as Env);
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  jwks = createLocalJWKSet({ keys: [jwk] });

  await run(env.DB, `INSERT OR IGNORE INTO users (email, role) VALUES ('owner-l@example.com', 'owner')`);
  const cpa = await run(
    env.DB,
    `INSERT INTO users (email, role, access_ends_on) VALUES ('cpa-l@example.com', 'accountant', '2030-01-01')`,
  );
  await run(env.DB, `INSERT INTO user_features (user_id, feature, enabled) VALUES (?, 'income_documents', 1)`, cpa.lastRowId);

  for (let i = 0; i < 3; i++) {
    await run(
      env.DB,
      `INSERT INTO audit_log (user_email, role, action, entity, entity_id, details) VALUES ('cpa-l@example.com', 'accountant', 'probe.seeded', 'route', ?, '{}')`,
      `/api/probe/${i}`,
    );
  }
});

describe('GET /access/log', () => {
  it('owner only', async () => {
    expect((await get('/access/log', 'cpa-l@example.com')).status).toBe(403);
    expect((await get('/access/log', 'owner-l@example.com')).status).toBe(200);
  });

  it('returns entries newest first with a cursor for older pages', async () => {
    // action=probe.seeded excludes the audit row the 403 attempt above wrote for this accountant.
    const res = await get('/access/log?limit=2&action=probe.seeded', 'owner-l@example.com');
    const body = (await res.json()) as { entries: { entityId: string }[]; nextBefore: number | null };
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]!.entityId).toBe('/api/probe/2');
    expect(body.nextBefore).not.toBeNull();

    const next = await get(`/access/log?limit=2&action=probe.seeded&before=${body.nextBefore}`, 'owner-l@example.com');
    const nextBody = (await next.json()) as { entries: { entityId: string }[] };
    expect(nextBody.entries.map((e) => e.entityId)).toContain('/api/probe/0');
  });

  it('filters by user email', async () => {
    const res = await get('/access/log?userEmail=cpa-l@example.com&limit=50', 'owner-l@example.com');
    const body = (await res.json()) as { entries: { userEmail: string }[] };
    expect(body.entries.length).toBeGreaterThanOrEqual(3);
    expect(body.entries.every((e) => e.userEmail === 'cpa-l@example.com')).toBe(true);
  });
});
