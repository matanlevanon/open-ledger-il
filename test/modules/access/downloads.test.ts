import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { run } from '../../../src/core/db';
import { createApp } from '../../../src/index';
import { signDownloadUrl } from '../../../src/modules/access/downloads';
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

  await run(env.DB, `INSERT OR IGNORE INTO users (email, role) VALUES ('owner-d@example.com', 'owner')`);
  const cpa = await run(
    env.DB,
    `INSERT INTO users (email, role, access_ends_on) VALUES ('cpa-d@example.com', 'accountant', '2030-01-01')`,
  );
  await run(env.DB, `INSERT INTO user_features (user_id, feature, enabled) VALUES (?, 'expenses', 1)`, cpa.lastRowId);
});

describe('signed R2 downloads', () => {
  it('streams the object back when the signature, expiry, and the caller feature all hold', async () => {
    await env.FILES.put('expenses/1/receipt.pdf', 'pdf-bytes', { httpMetadata: { contentType: 'application/pdf' } });
    const { path } = await signDownloadUrl(env, 'expenses/1/receipt.pdf', 'expenses');

    const res = await get(path, 'cpa-d@example.com');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('pdf-bytes');
    expect(res.headers.get('content-disposition')).toContain('receipt.pdf');
  });

  it('refuses a caller who no longer holds the feature named in the token', async () => {
    await env.FILES.put('expenses/2/receipt.pdf', 'pdf-bytes');
    const { path } = await signDownloadUrl(env, 'expenses/2/receipt.pdf', 'ita');
    // The owner holds every feature; a plain accountant probe belongs in downloads-forbidden below.
    const res = await get(path, 'cpa-d@example.com');
    expect(res.status).toBe(403);
  });

  it('refuses a tampered token', async () => {
    const { path } = await signDownloadUrl(env, 'expenses/3/receipt.pdf', 'expenses');
    // Flip the second-to-last character, not the last one. The token ends with a base64url-
    // encoded HMAC-SHA256 (32 bytes): the final base64 character of that fixed-length digest
    // sits in a partial group and carries two don't-care padding bits alongside its four real
    // ones, so two different final characters can decode to the exact same bytes ('a' and 'b'
    // are exactly such a pair: same top four bits, different padding bits). That made the old
    // version of this test flake whenever the real signature happened to end in one of that
    // group's four characters ('Y', 'Z', 'a' or 'b'), since the "tampered" token still verified.
    // Every earlier character sits in a full, unpadded group and always changes the decoded
    // bytes when flipped.
    const i = path.length - 2;
    const tampered = path.slice(0, i) + (path[i] === 'a' ? 'b' : 'a') + path.slice(i + 1);
    const res = await get(tampered, 'cpa-d@example.com');
    expect(res.status).toBe(401);
  });

  it('refuses an expired token', async () => {
    const { path } = await signDownloadUrl(env, 'expenses/4/receipt.pdf', 'expenses', -1);
    const res = await get(path, 'cpa-d@example.com');
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { message: string } }).toMatchObject({
      error: { message: 'This download link has expired.' },
    });
  });

  it('answers 404 when the R2 object is gone', async () => {
    const { path } = await signDownloadUrl(env, 'expenses/missing/receipt.pdf', 'expenses');
    const res = await get(path, 'owner-d@example.com');
    expect(res.status).toBe(404);
  });
});
