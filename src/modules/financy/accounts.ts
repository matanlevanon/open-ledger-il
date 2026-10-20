import { type AuditActor, actorBiz, auditStatement } from '../../core/audit';
import { all, nowIso, stmt, transaction } from '../../core/db';
import { ConflictError, ValidationError } from '../../core/errors';
import type { Env } from '../../env';
import { type FinancyDeps, type SyncCounts, clientFor, credentialsFor, loadConnection, pickedIds } from './connection';
import { DEFAULT_SYNC_DAYS, FIRST_SYNC_DAYS, accountBalances, accountType, cardDueDay, isBlocked, isBusinessType, last4, syncFinancy } from './sync';

/**
 * R40 task 3b: the owner picks the accounts the business uses. Financy returns personal and
 * business accounts together, all marked "PRIV", so nothing is picked by default. Only CHECKING and
 * CARD accounts are offered. Unticking an account deletes its stored rows, after a confirm.
 */

export interface AvailableAccount {
  id: string;
  type: 'CHECKING' | 'CARD';
  provider: string | null;
  name: string | null;
  last4: string | null;
  currencies: string[];
  blocked: boolean;
  dueDay: string | null;
  picked: boolean;
}

/** The CHECKING and CARD accounts Financy holds for this user, read live. Blocked cards come last. */
export async function availableAccounts(env: Env, deps: FinancyDeps, businessId: number): Promise<AvailableAccount[]> {
  const row = await loadConnection(env.DB, businessId);
  if (!row || row.status === 'disconnected') throw new ConflictError('financy_not_connected', 'Financy is not connected.');
  const picked = new Set(pickedIds(row));
  const accounts = (await clientFor(await credentialsFor(env, row), deps).accounts()).filter((a) => a.id && isBusinessType(a));
  return accounts
    .map((a) => ({
      id: a.id!,
      type: accountType(a) as AvailableAccount['type'],
      provider: a.providerId ?? null,
      name: a.accountName?.trim() || null,
      last4: last4(a),
      // From the balance entries. The account's own currency can be "ILY" and counts only when there are none.
      currencies: accountBalances(a).length > 0 ? accountBalances(a).map((b) => b.currency) : a.currency ? [a.currency.toUpperCase()] : [],
      blocked: isBlocked(a),
      dueDay: accountType(a) === 'CARD' ? cardDueDay(a) : null,
      picked: picked.has(a.id!),
    }))
    .sort((a, b) => Number(a.blocked) - Number(b.blocked) || (a.type === b.type ? 0 : a.type === 'CHECKING' ? -1 : 1));
}

export interface PickResult {
  accountIds: string[];
  removed: string[];
  deletedTransactions: number;
  sync: SyncCounts | null;
}

/**
 * Saves the picked accounts. An account that was picked and now is not loses its stored account
 * row and transactions, so the first answer is 409 `financy_unpick` with the count until the
 * person confirms. Then the picked accounts sync: 90 days the first time, 35 after.
 */
export async function pickAccounts(env: Env, deps: FinancyDeps, ids: string[], confirm: boolean, actor: AuditActor): Promise<PickResult> {
  const businessId = actorBiz(actor);
  const row = await loadConnection(env.DB, businessId);
  if (!row || row.status === 'disconnected') throw new ConflictError('financy_not_connected', 'Financy is not connected.');
  const offered = new Set((await availableAccounts(env, deps, businessId)).map((a) => a.id));
  const wanted = [...new Set(ids)];
  const unknown = wanted.filter((id) => !offered.has(id));
  if (unknown.length > 0) throw new ValidationError('Pick bank or card accounts from the list Financy returns.');

  const before = pickedIds(row);
  const removed = before.filter((id) => !wanted.includes(id));
  const added = wanted.filter((id) => !before.includes(id));
  let stored = 0;
  if (removed.length > 0) {
    const marks = removed.map(() => '?').join(',');
    stored = (await all<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM bank_transactions WHERE business_id = ? AND account_financy_id IN (${marks})`, businessId, ...removed))[0]?.n ?? 0;
    if (stored > 0 && !confirm) {
      throw new ConflictError(
        'financy_unpick',
        `Unticking ${removed.length === 1 ? 'this account deletes its' : 'these accounts deletes their'} ${stored} stored transactions. Confirm to go on.`,
      );
    }
  }

  const marks = removed.map(() => '?').join(',');
  await transaction(env.DB, [
    stmt(env.DB, 'UPDATE financy_connection SET account_ids = ?, updated_at = ? WHERE business_id = ?', JSON.stringify(wanted), nowIso(), businessId),
    ...(removed.length > 0
      ? [
          stmt(env.DB, `DELETE FROM bank_transactions WHERE business_id = ? AND account_financy_id IN (${marks})`, businessId, ...removed),
          stmt(env.DB, `DELETE FROM bank_accounts WHERE business_id = ? AND financy_id IN (${marks})`, businessId, ...removed),
        ]
      : []),
    auditStatement(env.DB, actor, 'financy.accounts', 'financy_connection', businessId, { picked: wanted.length, removed: removed.length, deletedTransactions: stored }),
  ]);

  // A newly picked account gets 90 days of history, as on the first connect.
  const sync = wanted.length > 0 ? await syncFinancy(env, deps, businessId, { days: added.length > 0 ? FIRST_SYNC_DAYS : DEFAULT_SYNC_DAYS, actor }) : null;
  return { accountIds: wanted, removed, deletedTransactions: stored, sync };
}
