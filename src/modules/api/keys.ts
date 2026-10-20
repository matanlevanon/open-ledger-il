import { type AuditActor, actorBiz, auditStatement } from '../../core/audit';
import { all, first, run, stmt, transaction } from '../../core/db';
import { NotFoundError } from '../../core/errors';
import { sha256Hex, timingSafeEqual } from '../mcp/tokens';

/**
 * R41: API keys for /v1. A key is `ol_live_` plus 32 random bytes, base64url. Only its SHA-256 is
 * stored, with the last 4 characters. It is shown once. A key belongs to one business and has the
 * scope read or write. Write may create clients and draft documents, never more.
 */

export const KEY_PREFIX = 'ol_live_';
export const SCOPES = ['read', 'write'] as const;
export type Scope = (typeof SCOPES)[number];
/** Requests per key per minute. */
export const RATE_LIMIT = 120;
/** `last_used_at` is written at most once a minute per key. */
const LAST_USED_EVERY_MS = 60_000;

export interface ApiKeyRow {
  id: number;
  business_id: number;
  key_hash: string;
  last4: string;
  name: string;
  scope: Scope;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** What Settings lists. Never the hash. */
export interface ApiKeyView {
  id: number;
  name: string;
  scope: Scope;
  last4: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function newApiKey(): string {
  return KEY_PREFIX + base64url(crypto.getRandomValues(new Uint8Array(32)));
}

const view = (r: ApiKeyRow): ApiKeyView => ({ id: r.id, name: r.name, scope: r.scope, last4: r.last4, createdAt: r.created_at, createdBy: r.created_by, lastUsedAt: r.last_used_at });

export async function listApiKeys(db: D1Database, businessId: number): Promise<ApiKeyView[]> {
  return (await all<ApiKeyRow>(db, 'SELECT * FROM api_keys WHERE business_id = ? AND revoked_at IS NULL ORDER BY id DESC', businessId)).map(view);
}

/** Makes a key for the actor's business. Returns the plain key once. The audit row carries the name and last 4 only. */
export async function createApiKey(db: D1Database, actor: AuditActor, name: string, scope: Scope): Promise<{ key: string; apiKey: ApiKeyView }> {
  const key = newApiKey();
  const hash = await sha256Hex(key);
  const last4 = key.slice(-4);
  const businessId = actorBiz(actor);
  const by = actor.email ?? 'unknown';
  await transaction(db, [
    stmt(db, 'INSERT INTO api_keys (business_id, key_hash, last4, name, scope, created_by) VALUES (?, ?, ?, ?, ?, ?)', businessId, hash, last4, name, scope, by),
    stmt(
      db,
      `INSERT INTO audit_log (user_id, user_email, role, action, entity, entity_id, details, ip, user_agent, business_id)
       SELECT ?, ?, ?, 'api_key.create', 'api_key', CAST(id AS TEXT), ?, ?, ?, ? FROM api_keys WHERE key_hash = ?`,
      actor.userId,
      actor.email,
      actor.role,
      JSON.stringify({ name, scope, last4 }),
      actor.ip,
      actor.userAgent,
      businessId,
      hash,
    ),
  ]);
  const row = (await first<ApiKeyRow>(db, 'SELECT * FROM api_keys WHERE key_hash = ?', hash))!;
  return { key, apiKey: view(row) };
}

export async function revokeApiKey(db: D1Database, actor: AuditActor, id: number): Promise<void> {
  const businessId = actorBiz(actor);
  const row = await first<ApiKeyRow>(db, 'SELECT * FROM api_keys WHERE id = ? AND business_id = ? AND revoked_at IS NULL', id, businessId);
  if (!row) throw new NotFoundError('API key', id);
  await transaction(db, [
    stmt(db, 'UPDATE api_keys SET revoked_at = ?, revoked_by = ? WHERE id = ?', new Date().toISOString(), actor.email ?? 'unknown', id),
    auditStatement(db, actor, 'api_key.revoke', 'api_key', id, { name: row.name, last4: row.last4 }),
  ]);
}

export type VerifyResult = { ok: true; key: ApiKeyRow } | { ok: false; status: 401 | 403; code: string; message: string };

/**
 * Checks the presented key against the stored hashes in constant time. A missing, unknown or
 * revoked key is 401, one body for all. A good key used with another business is 403.
 */
export async function verifyApiKey(db: D1Database, presented: string, businessId: number | null, now = new Date()): Promise<VerifyResult> {
  const unauthorized = { ok: false as const, status: 401 as const, code: 'unauthorized', message: 'A valid API key is required.' };
  if (!presented.startsWith(KEY_PREFIX)) return unauthorized;
  const hash = await sha256Hex(presented);
  // The lookup narrows by hash. The compare below is the check, and it runs in constant time.
  const row = await first<ApiKeyRow>(db, 'SELECT * FROM api_keys WHERE key_hash = ?', hash);
  if (!row || !timingSafeEqual(hash, row.key_hash) || row.revoked_at) return unauthorized;
  if (businessId === null || row.business_id !== businessId) {
    return { ok: false, status: 403, code: 'wrong_business', message: 'This key belongs to another business, or X-Business-Id is missing.' };
  }
  const last = row.last_used_at ? Date.parse(row.last_used_at) : 0;
  if (now.getTime() - last >= LAST_USED_EVERY_MS) {
    const cutoff = new Date(now.getTime() - LAST_USED_EVERY_MS).toISOString();
    await run(db, 'UPDATE api_keys SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at <= ?)', now.toISOString(), row.id, cutoff);
  }
  return { ok: true, key: row };
}

/** Counts one request in this minute. Returns the seconds to wait when the key is over the limit. */
export async function rateLimit(db: D1Database, keyId: number, now = new Date()): Promise<number | null> {
  const minute = now.toISOString().slice(0, 16);
  const row = await first<{ count: number }>(
    db,
    `INSERT INTO api_rate (key_id, minute, count) VALUES (?, ?, 1)
     ON CONFLICT (key_id, minute) DO UPDATE SET count = count + 1 RETURNING count`,
    keyId,
    minute,
  );
  if ((row?.count ?? 0) <= RATE_LIMIT) return null;
  return Math.max(1, 60 - now.getUTCSeconds());
}

/** Daily: drops rate counters older than an hour and idempotency answers older than a day. */
export async function pruneApiTables(db: D1Database, now = new Date()): Promise<void> {
  await transaction(db, [
    stmt(db, 'DELETE FROM api_rate WHERE minute < ?', new Date(now.getTime() - 3_600_000).toISOString().slice(0, 16)),
    stmt(db, 'DELETE FROM api_idempotency WHERE created_at < ?', new Date(now.getTime() - 86_400_000).toISOString()),
  ]);
}
