import { type AuditActor, actorBiz, auditStatement } from '../../core/audit';
import { first, nowIso, stmt, transaction } from '../../core/db';
import { ValidationError } from '../../core/errors';
import { parseMajor } from '../../core/money';
import type { Env } from '../../env';
import { decryptToken, encryptToken, importTokenKey } from '../ita/crypto';
import { FinancyClient, type FinancyCredentials } from './client';

/**
 * R40: one Financy connection per business. The client secret is AES-GCM at rest with the same
 * key as the ITA tokens (ITA_TOKEN_KEY), and the additional data `financy:<business_id>`, so it
 * never decrypts as an ITA token or as another business's secret.
 */

export interface FinancyDeps {
  fetch: typeof fetch;
  /** Space between pages. Tests pass 0. */
  pageGapMs?: number;
}

export interface ConnectionRow {
  business_id: number;
  client_id: string;
  client_secret_enc: string | null;
  secret_last4: string | null;
  user_id: string;
  status: 'connected' | 'error' | 'disconnected';
  last_error: string | null;
  last_sync_at: string | null;
  last_sync_result: string | null;
  /** R40 task 3b: JSON array of the picked Financy account ids. */
  account_ids: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncCounts {
  accounts: number;
  transactions: number;
  new: number;
  matched: number;
}

/** What the Settings panel shows. Never the secret. */
export interface ConnectionView {
  connected: boolean;
  status: ConnectionRow['status'] | null;
  clientId: string | null;
  secretLast4: string | null;
  userId: string | null;
  lastError: string | null;
  lastSyncAt: string | null;
  lastSyncResult: SyncCounts | null;
  /** R40 task 3b: the picked accounts. Empty: "Choose the business accounts to start." */
  accountIds: string[];
  needsAccounts: boolean;
}

export const financyContext = (businessId: number) => `financy:${businessId}`;

/** The picked account ids. Nothing picked, or a row that does not parse, is an empty list. */
export function pickedIds(row: Pick<ConnectionRow, 'account_ids'> | null): string[] {
  if (!row?.account_ids) return [];
  try {
    const ids = JSON.parse(row.account_ids) as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
  } catch {
    return [];
  }
}

export async function loadConnection(db: D1Database, businessId: number): Promise<ConnectionRow | null> {
  return first<ConnectionRow>(db, 'SELECT * FROM financy_connection WHERE business_id = ?', businessId);
}

export function connectionView(row: ConnectionRow | null): ConnectionView {
  const live = row && row.status !== 'disconnected' ? row : null;
  let counts: SyncCounts | null = null;
  try {
    counts = live?.last_sync_result ? (JSON.parse(live.last_sync_result) as SyncCounts) : null;
  } catch {
    counts = null;
  }
  return {
    connected: live?.status === 'connected',
    status: live?.status ?? null,
    clientId: live?.client_id ?? null,
    secretLast4: live?.secret_last4 ?? null,
    userId: live?.user_id ?? null,
    lastError: live?.last_error ?? null,
    lastSyncAt: live?.last_sync_at ?? null,
    lastSyncResult: counts,
    accountIds: live ? pickedIds(live) : [],
    needsAccounts: live?.status === 'connected' && pickedIds(live).length === 0,
  };
}

export async function encryptSecret(env: Pick<Env, 'ITA_TOKEN_KEY'>, businessId: number, secret: string): Promise<string> {
  return encryptToken(await importTokenKey(env.ITA_TOKEN_KEY), secret, financyContext(businessId));
}

/** The stored credentials, decrypted. A row with no secret is not connected. */
export async function credentialsFor(env: Env, row: ConnectionRow): Promise<FinancyCredentials> {
  if (!row.client_secret_enc || row.status === 'disconnected') throw new ValidationError('Financy is not connected.');
  const secret = await decryptToken(await importTokenKey(env.ITA_TOKEN_KEY), row.client_secret_enc, financyContext(row.business_id));
  return { clientId: row.client_id, clientSecret: secret, userId: row.user_id };
}

export function clientFor(creds: FinancyCredentials, deps: FinancyDeps): FinancyClient {
  return new FinancyClient(creds, deps.fetch, deps.pageGapMs);
}

/**
 * Tests the details with a token and one accounts call, then saves them. Nothing is saved when
 * Financy refuses. The secret goes into the row encrypted, and only its last 4 characters show.
 */
export async function saveConnection(env: Env, deps: FinancyDeps, creds: FinancyCredentials, actor: AuditActor): Promise<void> {
  const businessId = actorBiz(actor);
  const client = clientFor(creds, deps);
  await client.token(true);
  await client.accounts();
  const enc = await encryptSecret(env, businessId, creds.clientSecret);
  const last4 = creds.clientSecret.slice(-4);
  await transaction(env.DB, [
    stmt(
      env.DB,
      `INSERT INTO financy_connection (business_id, client_id, client_secret_enc, secret_last4, user_id, status, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, 'connected', NULL, ?)
       ON CONFLICT (business_id) DO UPDATE SET client_id = excluded.client_id, client_secret_enc = excluded.client_secret_enc,
         secret_last4 = excluded.secret_last4, user_id = excluded.user_id, status = 'connected', last_error = NULL, updated_at = excluded.updated_at`,
      businessId,
      creds.clientId,
      enc,
      last4,
      creds.userId,
      nowIso(),
    ),
    auditStatement(env.DB, actor, 'financy.connect', 'financy_connection', businessId, { clientId: creds.clientId, userId: creds.userId, secretLast4: last4 }),
  ]);
}

/** Drops the secret and stops the daily sync. Bank data already pulled stays. */
export async function disconnect(db: D1Database, actor: AuditActor): Promise<void> {
  const businessId = actorBiz(actor);
  await transaction(db, [
    stmt(db, "UPDATE financy_connection SET status = 'disconnected', client_secret_enc = NULL, last_error = NULL, updated_at = ? WHERE business_id = ?", nowIso(), businessId),
    auditStatement(db, actor, 'financy.disconnect', 'financy_connection', businessId, {}),
  ]);
}

/** Deletes every pulled account and transaction of the business. The connection stays as it is. */
export async function deleteBankData(db: D1Database, actor: AuditActor): Promise<{ accounts: number; transactions: number }> {
  const businessId = actorBiz(actor);
  const counts = await first<{ a: number; t: number }>(
    db,
    'SELECT (SELECT COUNT(*) FROM bank_accounts WHERE business_id = ?) AS a, (SELECT COUNT(*) FROM bank_transactions WHERE business_id = ?) AS t',
    businessId,
    businessId,
  );
  const deleted = { accounts: counts?.a ?? 0, transactions: counts?.t ?? 0 };
  await transaction(db, [
    stmt(db, 'DELETE FROM bank_transactions WHERE business_id = ?', businessId),
    stmt(db, 'DELETE FROM bank_accounts WHERE business_id = ?', businessId),
    auditStatement(db, actor, 'financy.delete_data', 'financy_connection', businessId, deleted),
  ]);
  return deleted;
}

/**
 * A Financy amount (a JSON number or a decimal string) in minor units. It goes through
 * `parseMajor`, never stored as a float. Every Financy currency is read with 2 decimals.
 */
export function toMinor(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return parseMajor(n.toFixed(2), 'ILS');
}
