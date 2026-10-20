import { beforeAll, describe, expect, it } from 'vitest';
import { first, run } from '../../../src/core/db';
import { createApp } from '../../../src/index';
import { pruneApiTables, revokeApiKey, verifyApiKey } from '../../../src/modules/api/keys';
import { sha256Hex } from '../../../src/modules/mcp/tokens';
import { businessesApp, okIn, OWNER } from '../businesses/helpers';
import { env, makeKey, ownerActor, v1, wholeDatabase } from './helpers';

/** R41 task 1: API keys. Stored as a hash, revoked keys refused, one business per key. */

let b2 = 0;

beforeAll(async () => {
  const bapp = businessesApp();
  await okIn(bapp, OWNER, null, 'GET', '/businesses');
  b2 = (await okIn(bapp, OWNER, 1, 'POST', '/businesses', { entityType: 'company', nameEn: 'Second Ltd', nameHe: 'שני בע"מ', taxId: '516666666', addressEn: 'Haifa' })).businessId;
  await run(env.DB, "UPDATE businesses SET tax_id = '000000018' WHERE id = 1");
});

describe('R41: API keys', () => {
  it('is ol_live_ and 32 bytes base64url, stored only as its SHA-256 with the last 4', async () => {
    const { key, apiKey } = await makeKey('read', 1, 'Financy');
    expect(key).toMatch(/^ol_live_[A-Za-z0-9_-]{43}$/);
    expect(apiKey).toMatchObject({ name: 'Financy', scope: 'read', last4: key.slice(-4), lastUsedAt: null });
    expect(await wholeDatabase()).not.toContain(key);
    const row = await first<{ key_hash: string }>(env.DB, 'SELECT key_hash FROM api_keys WHERE id = ?', apiKey.id);
    expect(row?.key_hash).toBe(await sha256Hex(key));
    const audit = await first<{ details: string }>(env.DB, "SELECT details FROM audit_log WHERE action = 'api_key.create' AND entity_id = ?", String(apiKey.id));
    expect(JSON.parse(audit!.details)).toEqual({ name: 'Financy', scope: 'read', last4: key.slice(-4) });
  });

  it('refuses a missing, unknown, malformed or revoked key with one 401 body', async () => {
    const { key, apiKey } = await makeKey();
    const refused = [await v1('/business'), await v1('/business', { key: 'ol_live_nope' }), await v1('/business', { key: 'not-a-key' })];
    await revokeApiKey(env.DB, ownerActor(1), apiKey.id);
    refused.push(await v1('/business', { key }));
    for (const r of refused) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: { code: 'unauthorized', message: 'A valid API key is required.' } });
    }
  });

  it('a key used with another business, an unknown one or none gets 403', async () => {
    const { key } = await makeKey();
    for (const business of [String(b2), '999999', null]) {
      const r = await v1('/business', { key, business });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('wrong_business');
    }
  });

  it('accepts the business tax number as the Business ID', async () => {
    const { key } = await makeKey();
    const r = await v1('/business', { key, business: '000000018' });
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(1);
  });

  it('compares the hash in constant time', async () => {
    expect(verifyApiKey.toString()).toContain('timingSafeEqual');
  });

  it('writes last_used_at at most once a minute', async () => {
    const { key, apiKey } = await makeKey();
    const t0 = new Date('2026-10-20T10:00:00Z');
    await verifyApiKey(env.DB, key, 1, t0);
    await verifyApiKey(env.DB, key, 1, new Date('2026-10-20T10:00:30Z'));
    expect((await first<{ last_used_at: string }>(env.DB, 'SELECT last_used_at FROM api_keys WHERE id = ?', apiKey.id))?.last_used_at).toBe(t0.toISOString());
    await verifyApiKey(env.DB, key, 1, new Date('2026-10-20T10:01:05Z'));
    expect((await first<{ last_used_at: string }>(env.DB, 'SELECT last_used_at FROM api_keys WHERE id = ?', apiKey.id))?.last_used_at).toBe('2026-10-20T10:01:05.000Z');
  });

  it('the daily prune drops old rate counters and idempotency answers', async () => {
    await run(env.DB, "INSERT INTO api_rate (key_id, minute, count) VALUES (999, '2026-10-19T08:00', 3), (999, '2026-10-20T09:59', 3)");
    await run(env.DB, "INSERT INTO api_idempotency (key_id, idem_key, business_id, request_hash, status, response, created_at) VALUES (999, 'old', 1, 'h', 201, '{}', '2026-10-18T00:00:00.000Z')");
    await pruneApiTables(env.DB, new Date('2026-10-20T10:30:00Z'));
    const minutes = await env.DB.prepare('SELECT minute FROM api_rate WHERE key_id = 999').all<{ minute: string }>();
    expect(minutes.results.map((m) => m.minute)).toEqual(['2026-10-20T09:59']);
    expect(await first(env.DB, "SELECT 1 FROM api_idempotency WHERE idem_key = 'old'")).toBeNull();
  });
});

describe('R41: Settings > MCP and API, the keys', () => {
  const app = createApp();
  const settings = (init: RequestInit = {}, email = 'owner@example.com', path = '') =>
    app.request(`/api/settings/api-keys${path}`, { ...init, headers: { 'content-type': 'application/json', ...init.headers } }, { ...env, DEV_AUTH_EMAIL: email });

  it('shows the address and Business ID, makes a key once, lists it without the key, and revokes it', async () => {
    const made = await settings({ method: 'POST', body: JSON.stringify({ name: 'Make', scope: 'write' }) });
    expect(made.status).toBe(201);
    const { key, apiKey } = (await made.json()) as { key: string; apiKey: { id: number } };
    const list = (await (await settings()).json()) as { address: string; businessId: number; keys: { id: number; scope: string }[] };
    expect(list.address).toMatch(/\/v1$/);
    expect(list.businessId).toBe(1);
    expect(list.keys.find((k) => k.id === apiKey.id)).toMatchObject({ scope: 'write' });
    expect(JSON.stringify(list)).not.toContain(key);
    expect((await settings({ method: 'DELETE' }, 'owner@example.com', `/${apiKey.id}`)).status).toBe(200);
    expect(((await (await settings()).json()) as { keys: { id: number }[] }).keys.some((k) => k.id === apiKey.id)).toBe(false);
    expect(await first(env.DB, "SELECT 1 FROM audit_log WHERE action = 'api_key.revoke' AND entity_id = ?", String(apiKey.id))).not.toBeNull();
  });

  it('refuses everyone but the owner', async () => {
    await run(env.DB, "INSERT OR IGNORE INTO users (email, role, access_ends_on) VALUES ('acct-r41@example.com', 'accountant', '2099-12-31')");
    expect((await settings({}, 'acct-r41@example.com')).status).toBe(403);
  });
});
