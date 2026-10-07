import { SYSTEM_ACTOR } from '../../core/audit';
import { all, run } from '../../core/db';
import { DomainError } from '../../core/errors';
import { type ItaEnv, ITA_WEB_APP_URL, itaEnvironment, itaManualMode } from './config';
import { ItaReconnectError } from './errors';
import { type ItaDeps, ItaAllocationService } from './service';

/** Cron expressions this module answers. Also listed in wrangler.toml. */
export const ITA_CRONS = {
  retryQueue: '*/15 * * * *',
  tokenCheck: '30 5 * * *',
} as const;

/**
 * Days after the interactive login when the Slack reminder goes out: a first notice, a second,
 * and the last day. The login ends on day 90. The dashboard banner starts at day 80.
 */
export const RELOGIN_REMINDER_DAYS = [75, 85, 89] as const;
export const RELOGIN_REMINDER_DAY = RELOGIN_REMINDER_DAYS[0];
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
    const why = row.attempts === 0 ? 'after 24 hours' : `after 24 hours and ${row.attempts} tries`;
    const sent = await notifier.send(
      `Open Ledger IL: document ${row.document_id} has no ITA allocation number ${why}. ` +
        `Request the number in the ITA web app (${ITA_WEB_APP_URL}) and enter it on the ITA screen.`,
    );
    if (sent) {
      await run(env.DB, 'UPDATE ita_allocations SET alerted_at = ? WHERE id = ?', now, row.id);
      result.alerts++;
    }
  }

  // Manual mode never calls the ITA. The reminders above still go out.
  if (itaManualMode(env)) return result;

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

/** Which reminder (1, 2 or 3) is due on a given day after the login. 0 means none yet. */
export function reminderStage(daysSinceLogin: number): number {
  let stage = 0;
  RELOGIN_REMINDER_DAYS.forEach((day, i) => {
    if (daysSinceLogin >= day) stage = i + 1;
  });
  return stage;
}

/**
 * Daily: reads the login dates and sends the re-login reminders on days 75, 85 and 89.
 *
 * It does not renew the login every night. The ITA login lasts 90 days from the interactive
 * sign-in whatever happens in between (developer guide: refresh without signing in until the
 * earlier of the consent count or 3 months), so a nightly renewal proves little and adds a daily
 * chance to fail. The short-lived access token is renewed when a call needs it.
 */
export async function runTokenCheck(env: ItaEnv, deps: ItaDeps): Promise<TokenCheckResult> {
  const service = new ItaAllocationService(env, deps);
  const tokens = service.tokens;
  const notifier = deps.notifier(env);
  const status = await tokens.status();
  if (status.status !== 'active') return { status: status.status, refreshed: false, reminded: false };

  if ((status.days_until_relogin ?? 0) <= 0) {
    await tokens.markReconnect('The ITA login expired after 90 days.');
    await notifier.send(`Open Ledger IL: the ITA ${status.environment} login expired. Open the ITA screen and connect again.`);
    return { status: 'reconnect_required', refreshed: false, reminded: true };
  }

  const days = status.days_since_login ?? 0;
  const due = reminderStage(days);
  const nowMs = deps.now().getTime();
  const sentAtDay = status.reminder_sent_at ? days - Math.floor((nowMs - Date.parse(status.reminder_sent_at)) / 86_400_000) : -1;
  const sent = sentAtDay >= 0 ? reminderStage(sentAtDay) : 0;

  let reminded = false;
  if (due > sent) {
    const left = status.days_until_relogin ?? 0;
    const when = left <= 1 ? 'tomorrow' : `in ${left} days`;
    reminded = await notifier.send(
      `Open Ledger IL: the ITA ${status.environment} login ends ${when}. ` +
        'Open the ITA screen and connect again with your user code and one-time code.',
    );
    if (reminded) await tokens.markReminderSent();
  }
  return { status: status.status, refreshed: false, reminded };
}
