import { type AuditActor, actorBiz, auditStatement } from '../../core/audit';
import { first, nowIso, stmt, transaction } from '../../core/db';
import { DomainError, ValidationError } from '../../core/errors';
import type { Env } from '../../env';
import type { SyncCounts } from '../financy/connection';
import { decryptToken, encryptToken, importTokenKey, randomToken } from '../ita/crypto';
import { WISE_EVENT, WISE_MESSAGES, WiseClient, WiseError, type WiseProfile } from './client';

/**
 * R49: one Wise Business connection per business. The API token is AES-GCM at rest with the same
 * key as the ITA tokens (ITA_TOKEN_KEY) and the additional data `wise:<business_id>`. No answer,
 * log or audit row carries it: the panel shows its last 4 characters.
 */

export interface WiseDeps {
  fetch: typeof fetch;
  /** The key Wise signs its webhooks with. Tests pass their own. Default: Wise's production key. */
  publicKeyPem?: string;
}

export interface WiseRow {
  business_id: number;
  token_enc: string | null;
  token_last4: string | null;
  profile_id: number;
  profile_name: string | null;
  hook_id: string;
  subscription_id: string | null;
  status: 'connected' | 'error' | 'disconnected';
  last_error: string | null;
  last_sync_at: string | null;
  last_sync_result: string | null;
  last_event_at: string | null;
}

/** What the Settings panel shows. Never the token. */
export interface WiseView {
  connected: boolean;
  status: WiseRow['status'] | null;
  tokenLast4: string | null;
  profileName: string | null;
  lastError: string | null;
  lastSyncAt: string | null;
  lastSyncResult: SyncCounts | null;
  webhook: {
    /** The address Wise calls. Null when nothing is connected. */
    url: string | null;
    /** The event to pick when the webhook is made by hand in Wise. */
    event: string;
    /** `auto`: the Ledger made it through the API. `manual`: make it in Wise with the address above. */
    state: 'auto' | 'manual';
    lastEventAt: string | null;
  };
}

export const wiseContext = (businessId: number) => `wise:${businessId}`;
export const hookUrl = (origin: string, hookId: string) => `${origin.replace(/\/+$/, '')}/v1/hooks/wise/${hookId}`;

export async function loadWise(db: D1Database, businessId: number): Promise<WiseRow | null> {
  return first<WiseRow>(db, 'SELECT * FROM wise_connection WHERE business_id = ?', businessId);
}

export function wiseView(row: WiseRow | null, origin: string): WiseView {
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
    tokenLast4: live?.token_last4 ?? null,
    profileName: live?.profile_name ?? null,
    lastError: live?.last_error ?? null,
    lastSyncAt: live?.last_sync_at ?? null,
    lastSyncResult: counts,
    webhook: {
      url: live ? hookUrl(origin, live.hook_id) : null,
      event: WISE_EVENT,
      state: live?.subscription_id ? 'auto' : 'manual',
      lastEventAt: live?.last_event_at ?? null,
    },
  };
}

export async function tokenFor(env: Pick<Env, 'ITA_TOKEN_KEY'>, row: WiseRow): Promise<string> {
  if (!row.token_enc || row.status === 'disconnected') throw new ValidationError('Wise is not connected.');
  return decryptToken(await importTokenKey(env.ITA_TOKEN_KEY), row.token_enc, wiseContext(row.business_id));
}

export function clientFor(token: string, deps: WiseDeps): WiseClient {
  return new WiseClient(token, deps.fetch);
}

const isBusiness = (p: WiseProfile) => (p.type ?? '').toUpperCase() === 'BUSINESS' && typeof p.id === 'number';
const profileName = (p: WiseProfile) => (p.businessName ?? p.fullName ?? '').trim().slice(0, 200) || null;

/**
 * Asks Wise to send balance updates to the Ledger's address. An address already subscribed is
 * reused. Wise documents this call for partner tokens, so a refusal is expected for some accounts:
 * it returns null and the panel tells the owner to make the webhook in Wise by hand.
 */
export async function ensureSubscription(client: WiseClient, profileId: number, url: string): Promise<string | null> {
  try {
    const existing = (await client.subscriptions(profileId)).find((s) => s.trigger_on === WISE_EVENT && s.delivery?.url === url && typeof s.id === 'string');
    if (existing) return existing.id!;
    const made = await client.createSubscription(profileId, 'Open Ledger: money in and out', url);
    return typeof made.id === 'string' && made.id ? made.id : null;
  } catch (err) {
    // A bad token must stop the connect. Any other refusal only means "make the webhook by hand".
    if (err instanceof WiseError && err.code === 'wise_auth') throw err;
    return null;
  }
}

/**
 * Tests the token with a profiles call and a balances call, then saves it. Nothing is saved when
 * Wise refuses. Only a Business profile is ever read: a token with several picks by `profileId`,
 * and a token with none is refused. The webhook address is kept across reconnects, so a webhook
 * made by hand in Wise keeps working after a new token.
 */
export async function saveWise(env: Env, deps: WiseDeps, input: { token: string; profileId?: number }, origin: string, actor: AuditActor): Promise<void> {
  const businessId = actorBiz(actor);
  const client = clientFor(input.token, deps);
  const business = (await client.profiles()).filter(isBusiness);
  if (business.length === 0) throw new WiseError('wise_no_business', WISE_MESSAGES.wise_no_business, 409);
  const profile = input.profileId ? business.find((p) => p.id === input.profileId) : business.length === 1 ? business[0] : undefined;
  if (!profile) {
    throw new DomainError('wise_pick_profile', 'This token reaches more than one Wise Business profile. Pick one.', 409, {
      profiles: business.map((p) => ({ id: p.id, name: profileName(p) })),
    });
  }
  await client.balances(profile.id!);

  const before = await loadWise(env.DB, businessId);
  const hookId = before?.hook_id ?? randomToken(24);
  const enc = await encryptToken(await importTokenKey(env.ITA_TOKEN_KEY), input.token, wiseContext(businessId));
  const last4 = input.token.slice(-4);
  await transaction(env.DB, [
    stmt(
      env.DB,
      `INSERT INTO wise_connection (business_id, token_enc, token_last4, profile_id, profile_name, hook_id, subscription_id, status, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'connected', NULL, ?)
       ON CONFLICT (business_id) DO UPDATE SET token_enc = excluded.token_enc, token_last4 = excluded.token_last4, profile_id = excluded.profile_id,
         profile_name = excluded.profile_name, subscription_id = NULL, status = 'connected', last_error = NULL, updated_at = excluded.updated_at`,
      businessId,
      enc,
      last4,
      profile.id!,
      profileName(profile),
      hookId,
      nowIso(),
    ),
    auditStatement(env.DB, actor, 'wise.connect', 'wise_connection', businessId, { profileId: profile.id, last4 }),
  ]);

  // The row is saved first: Wise sends a test event to the address while it creates the webhook.
  const subscriptionId = await ensureSubscription(client, profile.id!, hookUrl(origin, hookId));
  if (subscriptionId) await env.DB.prepare('UPDATE wise_connection SET subscription_id = ?, updated_at = ? WHERE business_id = ?').bind(subscriptionId, nowIso(), businessId).run();
}

/** Drops the token, removes a webhook the Ledger made, and stops the sync. Bank rows already pulled stay. */
export async function disconnectWise(env: Env, deps: WiseDeps, actor: AuditActor): Promise<void> {
  const businessId = actorBiz(actor);
  const row = await loadWise(env.DB, businessId);
  if (row && row.status !== 'disconnected' && row.subscription_id) {
    try {
      await clientFor(await tokenFor(env, row), deps).deleteSubscription(row.profile_id, row.subscription_id);
    } catch {
      // The webhook stays in Wise. Its events answer 404 from now on, and Wise stops after three tries.
    }
  }
  await transaction(env.DB, [
    stmt(
      env.DB,
      "UPDATE wise_connection SET status = 'disconnected', token_enc = NULL, subscription_id = NULL, last_error = NULL, updated_at = ? WHERE business_id = ?",
      nowIso(),
      businessId,
    ),
    auditStatement(env.DB, actor, 'wise.disconnect', 'wise_connection', businessId, {}),
  ]);
}
