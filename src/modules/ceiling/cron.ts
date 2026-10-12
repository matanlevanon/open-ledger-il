import { listBusinessIds } from '../../core/business';
import { todayIsrael } from '../../core/db';
import type { Env } from '../../env';
import { slackNotifier } from '../ita/notify';
import { evaluateCeilingAlerts } from './alerts';

/**
 * Daily sweep, independent of any receipt being finalized. Must match the entry in
 * wrangler.toml's `[triggers] crons`. Catches the case the crossing block cannot: open payment
 * requests alone (no new receipt) already project turnover past a threshold.
 */
export const CEILING_ALERT_CRON = '0 7 * * *';

export async function ceilingScheduled(controller: ScheduledController, env: Env, _ctx?: ExecutionContext): Promise<void> {
  if (controller.cron !== CEILING_ALERT_CRON) return;
  // R24: each business has its own turnover and legal mode. Only a פטור business has a ceiling.
  const notifier = slackNotifier(env.SLACK_WEBHOOK_URL, (input, init) => fetch(input, init));
  for (const businessId of await listBusinessIds(env.DB)) await evaluateCeilingAlerts(env.DB, todayIsrael(), notifier, businessId);
}
