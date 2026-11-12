import { type AuditActor, auditStatement } from '../../core/audit';
import { first, stmt, transaction } from '../../core/db';

/**
 * R34: the MCP token. The installer sets the Worker secret MCP_TOKEN, which nobody can read back.
 * Settings > MCP makes a token the Ledger keeps itself, in `mcp_tokens`, stored only as its SHA-256.
 * Once a Ledger token is active, MCP_TOKEN stops working. `mcp.enabled` off refuses every call.
 */

export const MCP_ENABLED_KEY = 'mcp.enabled';
export const TOKEN_PREFIX = 'olil_';
/** `last_used_at` is written at most this often per token, so MCP calls do not write D1 on every request. */
export const LAST_USED_EVERY_MS = 60 * 60 * 1000;

export interface ActiveToken {
  id: number;
  token_hash: string;
  last4: string;
  created_at: string;
  created_by: string;
  last_used_at: string | null;
  /** R48: the business this token reaches. Null: every business (the Ledger-wide token). */
  business_id: number | null;
}

/** R48: what a valid token reaches. businessId null means every business. */
export interface McpScope {
  businessId: number | null;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison, so a wrong guess never leaks timing information. */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let diff = bufA.length ^ bufB.length;
  const len = Math.max(bufA.length, bufB.length);
  for (let i = 0; i < len; i++) diff |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  return diff === 0;
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 random bytes, base64url, with the `olil_` prefix. */
export function newToken(): string {
  return TOKEN_PREFIX + base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function mcpEnabled(db: D1Database): Promise<boolean> {
  const row = await first<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', MCP_ENABLED_KEY);
  return row?.value !== '0';
}

/** The active token of one scope: a business, or null for the Ledger-wide token. */
export async function activeToken(db: D1Database, businessId: number | null = null): Promise<ActiveToken | null> {
  return first<ActiveToken>(
    db,
    `SELECT id, token_hash, last4, created_at, created_by, last_used_at, business_id FROM mcp_tokens
      WHERE revoked_at IS NULL AND business_id IS ?`,
    businessId,
  );
}

/**
 * True when the presented bearer token may call MCP. Every refusal is the same `false`, so the
 * caller never says which check failed.
 */
export async function checkMcpToken(db: D1Database, workerSecret: string | undefined, presented: string, now = new Date()): Promise<boolean> {
  return (await mcpTokenScope(db, workerSecret, presented, now)) !== null;
}

/**
 * R48: the scope of the presented token, or null when it may not call MCP. The MCP_TOKEN secret
 * counts as a Ledger-wide token, and works only while no Ledger-wide token is active in D1.
 */
export async function mcpTokenScope(db: D1Database, workerSecret: string | undefined, presented: string, now = new Date()): Promise<McpScope | null> {
  const hash = await sha256Hex(presented);
  const [enabledRes, tokenRes, ledgerRes] = await db.batch([
    db.prepare('SELECT value FROM settings WHERE key = ?').bind(MCP_ENABLED_KEY),
    db.prepare('SELECT id, token_hash, last_used_at, business_id FROM mcp_tokens WHERE revoked_at IS NULL AND token_hash = ?').bind(hash),
    db.prepare('SELECT 1 AS n FROM mcp_tokens WHERE revoked_at IS NULL AND business_id IS NULL'),
  ]);
  const enabled = (enabledRes!.results[0] as { value: string } | undefined)?.value !== '0';
  const token = tokenRes!.results[0] as Pick<ActiveToken, 'id' | 'token_hash' | 'last_used_at' | 'business_id'> | undefined;
  const ledgerTokenActive = ledgerRes!.results.length > 0;
  if (!enabled) return null;
  if (!token) {
    if (ledgerTokenActive || !workerSecret) return null;
    return timingSafeEqual(presented, workerSecret) ? { businessId: null } : null;
  }
  if (!timingSafeEqual(hash, token.token_hash)) return null;
  const last = token.last_used_at ? Date.parse(token.last_used_at) : 0;
  if (now.getTime() - last >= LAST_USED_EVERY_MS) {
    // The WHERE repeats the check, so two calls in the same second write once.
    const cutoff = new Date(now.getTime() - LAST_USED_EVERY_MS).toISOString();
    await db
      .prepare('UPDATE mcp_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at <= ?)')
      .bind(now.toISOString(), token.id, cutoff)
      .run();
  }
  return { businessId: token.business_id };
}

/**
 * Makes a new token, revokes the active one in the same batch, audits both with the last 4 only.
 * Returns the plain token once. It is never stored.
 */
export async function makeMcpToken(
  db: D1Database,
  actor: AuditActor,
  businessId: number | null = null,
): Promise<{ token: string; id: number; last4: string }> {
  const token = newToken();
  const hash = await sha256Hex(token);
  const last4 = token.slice(-4);
  const by = actor.email ?? 'unknown';
  const now = new Date().toISOString();
  const old = await activeToken(db, businessId);
  const statements: D1PreparedStatement[] = [];
  if (old) {
    statements.push(stmt(db, 'UPDATE mcp_tokens SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL', now, by, old.id));
    statements.push(auditStatement(db, actor, 'mcp.token_revoke', 'mcp_token', old.id, { last4: old.last4 }));
  }
  statements.push(
    stmt(db, 'INSERT INTO mcp_tokens (token_hash, last4, created_at, created_by, business_id) VALUES (?, ?, ?, ?, ?)', hash, last4, now, by, businessId),
  );
  // The create audit row in the same batch, with the new row's id read back by its hash.
  statements.push(
    stmt(
      db,
      `INSERT INTO audit_log (user_id, user_email, role, action, entity, entity_id, details, ip, user_agent, business_id)
       SELECT ?, ?, ?, 'mcp.token_create', 'mcp_token', CAST(id AS TEXT), ?, ?, ?, ? FROM mcp_tokens WHERE token_hash = ?`,
      actor.userId,
      actor.email,
      actor.role,
      JSON.stringify({ last4, scope: businessId === null ? 'ledger' : businessId }),
      actor.ip,
      actor.userAgent,
      actor.businessId ?? 1,
      hash,
    ),
  );
  await transaction(db, statements);
  const row = await first<{ id: number }>(db, 'SELECT id FROM mcp_tokens WHERE token_hash = ?', hash);
  return { token, id: row!.id, last4 };
}

export async function setMcpEnabled(db: D1Database, actor: AuditActor, enabled: boolean): Promise<void> {
  await transaction(db, [
    stmt(
      db,
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      MCP_ENABLED_KEY,
      enabled ? '1' : '0',
      new Date().toISOString(),
    ),
    auditStatement(db, actor, enabled ? 'mcp.enable' : 'mcp.disable', 'settings', MCP_ENABLED_KEY, { enabled }),
  ]);
}
