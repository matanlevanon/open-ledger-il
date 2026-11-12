import { type AuditActor, auditStatement, systemActorFor } from '../../core/audit';
import { all, nowIso, stmt, todayIsrael, transaction } from '../../core/db';
import type { Env } from '../../env';
import { isDemo } from '../demo/config';
import type { FinancyTransaction } from '../financy/client';
import type { SyncCounts } from '../financy/connection';
import { storeBankData } from '../financy/sync';
import { WiseError } from './client';
import { type WiseDeps, clientFor, loadWise, tokenFor } from './connection';
import { wiseAccount, wiseTransactions } from './map';

/**
 * R49: pull the Wise Business balances and their statement rows into `bank_accounts` and
 * `bank_transactions`, then mark conversions and match, exactly as a Financy sync does. A row
 * already matched, ignored or added keeps its status. The first sync reads 90 days, the daily one
 * 35, and a webhook 7.
 */

export const WISE_FIRST_DAYS = 90;
export const WISE_DAILY_DAYS = 35;
export const WISE_EVENT_DAYS = 7;

function daysBack(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export function wiseErrorMessage(err: unknown): string {
  if (err instanceof WiseError) return err.message;
  return `The sync failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
}

export async function syncWise(
  env: Env,
  deps: WiseDeps,
  businessId: number,
  options: { days?: number; today?: string; actor?: AuditActor; now?: string } = {},
): Promise<SyncCounts> {
  const row = await loadWise(env.DB, businessId);
  if (!row || row.status === 'disconnected') throw new WiseError('wise_not_connected', 'Wise is not connected.', 409);
  const actor = options.actor ?? systemActorFor(businessId);
  const days = options.days ?? WISE_DAILY_DAYS;
  try {
    const client = clientFor(await tokenFor(env, row), deps);
    const balances = await client.balances(row.profile_id);
    const start = daysBack(options.today ?? todayIsrael(), days);
    const end = options.now ?? nowIso();
    const pulled: FinancyTransaction[] = [];
    for (const b of balances) pulled.push(...wiseTransactions(b, await client.statement(row.profile_id, b.id!, b.currency!, start, end)));
    const counts = await storeBankData(env.DB, businessId, balances.map(wiseAccount), pulled);
    await transaction(env.DB, [
      stmt(
        env.DB,
        "UPDATE wise_connection SET status = 'connected', last_error = NULL, last_sync_at = ?, last_sync_result = ?, updated_at = ? WHERE business_id = ?",
        nowIso(),
        JSON.stringify(counts),
        nowIso(),
        businessId,
      ),
      auditStatement(env.DB, actor, 'wise.sync', 'wise_connection', businessId, { ...counts, days }),
    ]);
    return counts;
  } catch (err) {
    await env.DB.prepare("UPDATE wise_connection SET status = 'error', last_error = ?, updated_at = ? WHERE business_id = ?").bind(wiseErrorMessage(err), nowIso(), businessId).run();
    throw err;
  }
}

/** The daily sync of every connected business. Never throws: a failure stays on its connection. */
export async function syncAllWiseDaily(env: Env, deps: WiseDeps): Promise<{ synced: number; failed: number }> {
  if (isDemo(env)) return { synced: 0, failed: 0 };
  const result = { synced: 0, failed: 0 };
  const rows = await all<{ business_id: number }>(
    env.DB,
    "SELECT w.business_id FROM wise_connection w JOIN businesses b ON b.id = w.business_id WHERE w.status IN ('connected', 'error') AND w.token_enc IS NOT NULL AND b.status = 'active'",
  );
  for (const { business_id } of rows) {
    try {
      await syncWise(env, deps, business_id, { days: WISE_DAILY_DAYS });
      result.synced += 1;
    } catch (err) {
      result.failed += 1;
      console.error('wise.sync_failed', business_id, err instanceof WiseError ? err.code : 'error');
      console.error('business_job_failed', 'wise.sync_daily', business_id);
    }
  }
  console.log('wise.sync_daily', result);
  return result;
}
