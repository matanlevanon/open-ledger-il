import { todayIsrael } from '../../core/db';
import type { Env } from '../../env';
import { slackNotifier } from '../ita/notify';
import { evaluateCeilingAlerts } from './alerts';

/**
 * Daily sweep, independent of any receipt being finalized. Must match the entry in
 * wrangler.toml's `[triggers] crons`. Catches the case the crossing block cannot: open payment
 * requests alone (no new receipt) already project turnover past a threshold.
 */
export const CEILING_ALERT_CRON = '0 9 * * *';

export async function ceilingScheduled(controller: ScheduledController, env: Env, _ctx?: ExecutionContext): Promise<void> {
  if (controller.cron !== CEILING_ALERT_CRON) return;
  await evaluateCeilingAlerts(env.DB, todayIsrael(), slackNotifier(env.SLACK_WEBHOOK_URL, (input, init) => fetch(input, init)));
}
