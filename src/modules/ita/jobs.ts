import { SYSTEM_ACTOR } from '../../core/audit';
import { all, run } from '../../core/db';
import { DomainError } from '../../core/errors';
import { type ItaEnv, ITA_WEB_APP_URL, itaEnvironment } from './config';
import { ItaReconnectError } from './errors';
import { type ItaDeps, ItaAllocationService } from './service';

/** Cron expressions this module answers. Also listed in wrangler.toml. */
export const ITA_CRONS = {
  retryQueue: '*/15 * * * *',
  tokenCheck: '30 5 * * *',
} as const;

/** Day after the interactive login when the Slack reminder goes out. The dashboard banner starts at day 80. */
export const RELOGIN_REMINDER_DAY = 75;
export const RELOGIN_BANNER_DAY = 80;

export interface QueueRunResult {
  retried: number;
  approved: number;
  stalled: number;
  alerts: number;
}

/**
 * Retries every pending allocation that is due, in one MultiApproval call. A request still
 * pending 24 hours after the first attempt stops retrying and raises one Slack alert.
 */
export async function runRetryQueue(env: ItaEnv, deps: ItaDeps): Promise<QueueRunResult> {
  const environment = itaEnvironment(env);
  const now = deps.now().toISOString();
  const result: QueueRunResult = { retried: 0, approved: 0, stalled: 0, alerts: 0 };

  const expired = await all<{ id: number; document_id: number; attempts: number }>(
    env.DB,
    `SELECT id, document_id, attempts FROM ita_allocations
     WHERE environment = ? AND status = 'pending' AND deadline_at IS NOT NULL AND deadline_at <= ?`,
    environment,
    now,
  );
  const notifier = deps.notifier(env);
  for (const row of expired) {
    await run(env.DB, `UPDATE ita_allocations SET status = 'stalled', next_attempt_at = NULL, updated_at = ? WHERE id = ?`, now, row.id);
    result.stalled++;
  }
  const unalerted = await all<{ id: number; document_id: number; attempts: number }>(
    env.DB,
    `SELECT id, document_id, attempts FROM ita_allocations WHERE environment = ? AND status = 'stalled' AND alerted_at IS NULL`,
    environment,
  );
  for (const row of unalerted) {
    const sent = await notifier.send(
      `Open Ledger IL: document ${row.document_id} has no ITA allocation number after 24 hours and ${row.attempts} tries. ` +
        `Request the number in the ITA web app (${ITA_WEB_APP_URL}) and enter it on the ITA screen.`,
    );
    if (sent) {
      await run(env.DB, 'UPDATE ita_allocations SET alerted_at = ? WHERE id = ?', now, row.id);
      result.alerts++;
    }
  }

  const due = await all<{ document_id: number }>(
    env.DB,
    `SELECT document_id FROM ita_allocations
     WHERE environment = ? AND status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY next_attempt_at LIMIT 100`,
    environment,
    now,
  );
  if (due.length === 0) return result;
  const service = new ItaAllocationService(env, deps);
  const outcomes = await service.requestMany(
    due.map((d) => d.document_id),
    SYSTEM_ACTOR,
  );
  result.retried = due.length;
  result.approved = outcomes.filter((o) => o.status === 'approved').length;
  return result;
}

export interface TokenCheckResult {
  status: 'not_connected' | 'active' | 'reconnect_required';
  refreshed: boolean;
  reminded: boolean;
}

/**
 * Daily: refreshes the token to prove the login still works, and sends the day-75 re-login
 * reminder once per login.
 */
export async function runTokenCheck(env: ItaEnv, deps: ItaDeps): Promise<TokenCheckResult> {
  const service = new ItaAllocationService(env, deps);
  const tokens = service.tokens;
  const notifier = deps.notifier(env);
  const before = await tokens.status();
  if (before.status === 'not_connected') return { status: 'not_connected', refreshed: false, reminded: false };

  let refreshed = false;
  if (before.status === 'active') {
    try {
      await tokens.refresh();
      refreshed = true;
    } catch (err) {
      if (err instanceof ItaReconnectError) {
        await notifier.send(`Open Ledger IL: the ITA ${before.environment} login stopped working. Open the ITA screen and connect again.`);
      } else if (!(err instanceof DomainError)) {
        throw err;
      }
    }
  }

  const status = await tokens.status();
  let reminded = false;
  if (status.status === 'active' && (status.days_since_login ?? 0) >= RELOGIN_REMINDER_DAY && !status.reminder_sent_at) {
    reminded = await notifier.send(
      `Open Ledger IL: the ITA ${status.environment} login ends in ${status.days_until_relogin} days. ` +
        'Open the ITA screen and connect again with your user code and one-time code.',
    );
    if (reminded) await tokens.markReminderSent();
  }
  return { status: status.status, refreshed, reminded };
}
