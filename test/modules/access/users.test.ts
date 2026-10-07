import { env } from 'cloudflare:workers';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { first, run } from '../../../src/core/db';
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
  return createApp({ auth: { keyResolver: () => jwks, today: () => '2026-10-01' } });
}

async function req(path: string, email: string, init: RequestInit = {}) {
  const headers = { 'Cf-Access-Jwt-Assertion': await token(email), 'content-type': 'application/json', ...init.headers };
  return app().request(`/api${path}`, { ...init, headers }, { ...env, DEV_AUTH_EMAIL: undefined } as Env);
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  jwks = createLocalJWKSet({ keys: [jwk] });
  await run(env.DB, `INSERT OR IGNORE INTO users (email, role) VALUES ('owner-u@example.com', 'owner')`);
});

describe('POST /access/users (invite)', () => {
  it('creates an accountant with the default feature switches when none are given', async () => {
    const res = await req('/access/users', 'owner-u@example.com', {
      method: 'POST',
      body: JSON.stringify({ email: 'New-CPA@Example.com', name: 'Dana', accessEndsOn: '2027-10-01' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: { email: string; features: Record<string, boolean> } };
    expect(body.user.email).toBe('new-cpa@example.com');
    expect(body.user.features).toMatchObject({ income_documents: true, bank_matches: false, notes: true });

    const log = await first<{ action: string }>(
      env.DB,
      `SELECT action FROM audit_log WHERE action = 'user.invite' AND entity_id = 'new-cpa@example.com'`,
    );
    expect(log?.action).toBe('user.invite');
  });

  it('applies feature overrides on top of the defaults', async () => {
    const res = await req('/access/users', 'owner-u@example.com', {
      method: 'POST',
      body: JSON.stringify({ email: 'picky@example.com', accessEndsOn: '2027-10-01', features: { expenses: false, bank_matches: true } }),
    });
    const body = (await res.json()) as { user: { features: Record<string, boolean> } };
    expect(body.user.features).toMatchObject({ expenses: false, bank_matches: true, income_documents: true });
  });

  it('refuses a second invite to the same email', async () => {
    await req('/access/users', 'owner-u@example.com', {
      method: 'POST',
      body: JSON.stringify({ email: 'dupe@example.com', accessEndsOn: '2027-10-01' }),
    });
    const res = await req('/access/users', 'owner-u@example.com', {
      method: 'POST',
      body: JSON.stringify({ email: 'dupe@example.com', accessEndsOn: '2027-10-01' }),
    });
    expect(res.status).toBe(409);
  });

  it('rejects a bad email, a past end date, and an unknown feature', async () => {
    const badEmail = await req('/access/users', 'owner-u@example.com', {
      method: 'POST',
      body: JSON.stringify({ email: 'not-an-email', accessEndsOn: '2027-10-01' }),
    });
    expect(badEmail.status).toBe(400);

    const pastDate = await req('/access/users', 'owner-u@example.com', {
      method: 'POST',
      body: JSON.stringify({ email: 'past@example.com', accessEndsOn: '2020-01-01' }),
    });
    expect(pastDate.status).toBe(400);

    const badFeature = await req('/access/users', 'owner-u@example.com', {
      method: 'POST',
      body: JSON.stringify({ email: 'feat@example.com', accessEndsOn: '2027-10-01', features: { settings: true } }),
    });
    expect(badFeature.status).toBe(400);
  });

  it('refuses the accountant', async () => {
    const cpa = await run(env.DB, `INSERT INTO users (email, role, access_ends_on) VALUES ('u-cpa@example.com', 'accountant', '2030-01-01')`);
    await run(env.DB, `INSERT INTO user_features (user_id, feature, enabled) VALUES (?, 'income_documents', 1)`, cpa.lastRowId);
    const res = await req('/access/users', 'u-cpa@example.com', { method: 'POST', body: JSON.stringify({ email: 'x@example.com', accessEndsOn: '2027-10-01' }) });
    expect(res.status).toBe(403);
  });
});

describe('GET /access/users', () => {
  it('lists owner and accountants with full feature maps, owner only', async () => {
    await req('/access/users', 'owner-u@example.com', {
      method: 'POST',
      body: JSON.stringify({ email: 'list-me@example.com', accessEndsOn: '2027-10-01', features: { expenses: false } }),
    });
    const res = await req('/access/users', 'owner-u@example.com');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: { email: string; role: string; features: Record<string, boolean> | null }[] };
    const owner = body.users.find((u) => u.email === 'owner-u@example.com');
    expect(owner?.features).toBeNull();
    const cpa = body.users.find((u) => u.email === 'list-me@example.com');
    expect(cpa?.features?.expenses).toBe(false);
  });
});

describe('PATCH /access/users/:id', () => {
  it('updates the end date, renews (reactivates) on a future date, and toggles a feature', async () => {
    const invite = await req('/access/users', 'owner-u@example.com', {
      method: 'POST',
      body: JSON.stringify({ email: 'renew@example.com', accessEndsOn: '2099-10-05' }),
    });
    const { user } = (await invite.json()) as { user: { id: number } };
    await run(env.DB, 'UPDATE users SET active = 0 WHERE id = ?', user.id);

    const res = await req(`/access/users/${user.id}`, 'owner-u@example.com', {
      method: 'PATCH',
      body: JSON.stringify({ accessEndsOn: '2027-10-05', features: { bank_matches: true } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { accessEndsOn: string; active: boolean; features: Record<string, boolean> } };
    expect(body.user.accessEndsOn).toBe('2027-10-05');
    expect(body.user.active).toBe(true);
    expect(body.user.features.bank_matches).toBe(true);
  });

  it('404s an unknown id and refuses to edit the owner through this route', async () => {
    const notFound = await req('/access/users/999999', 'owner-u@example.com', { method: 'PATCH', body: JSON.stringify({ name: 'x' }) });
    expect(notFound.status).toBe(404);

    const owner = await first<{ id: number }>(env.DB, `SELECT id FROM users WHERE email = 'owner-u@example.com'`);
    const res = await req(`/access/users/${owner!.id}`, 'owner-u@example.com', { method: 'PATCH', body: JSON.stringify({ name: 'x' }) });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /access/users/:id (revoke)', () => {
  it('deletes the accountant row and its features at once, and logs it', async () => {
    const invite = await req('/access/users', 'owner-u@example.com', {
      method: 'POST',
      body: JSON.stringify({ email: 'revoke-me@example.com', accessEndsOn: '2027-10-01' }),
    });
    const { user } = (await invite.json()) as { user: { id: number } };

    const res = await req(`/access/users/${user.id}`, 'owner-u@example.com', { method: 'DELETE' });
    expect(res.status).toBe(204);

    expect(await first(env.DB, 'SELECT 1 FROM users WHERE id = ?', user.id)).toBeNull();
    expect(await first(env.DB, 'SELECT 1 FROM user_features WHERE user_id = ?', user.id)).toBeNull();
    const log = await first<{ action: string }>(
      env.DB,
      `SELECT action FROM audit_log WHERE action = 'user.revoke' AND entity_id = 'revoke-me@example.com'`,
    );
    expect(log?.action).toBe('user.revoke');
  });

  it('never revokes the owner', async () => {
    const owner = await first<{ id: number }>(env.DB, `SELECT id FROM users WHERE email = 'owner-u@example.com'`);
    const res = await req(`/access/users/${owner!.id}`, 'owner-u@example.com', { method: 'DELETE' });
    expect(res.status).toBe(400);
    expect(await first(env.DB, 'SELECT 1 FROM users WHERE id = ?', owner!.id)).not.toBeNull();
  });
});
