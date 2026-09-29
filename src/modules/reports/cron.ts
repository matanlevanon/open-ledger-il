import { todayIsrael } from '../../core/db';
import type { Env } from '../../env';
import { buildAccountantPack, previousPeriod } from './pack';

/**
 * 5th of every month (docs/accountant-access.md "Monthly pack"). It rides on the daily 07:00 UTC
 * cron shared with reminders and recurring documents, so the Worker needs only 5 cron triggers,
 * and acts only when that day is the 5th. Must match wrangler.toml's `[triggers] crons`.
 */
export const ACCOUNTANT_PACK_CRON = '0 7 * * *';

/** True when the cron fired on the 5th of the month, in UTC. */
export function isPackDay(scheduledTime: number): boolean {
  return new Date(scheduledTime).getUTCDate() === 5;
}

export async function reportsScheduled(controller: ScheduledController, env: Env, _ctx?: ExecutionContext): Promise<void> {
  if (controller.cron !== ACCOUNTANT_PACK_CRON || !isPackDay(controller.scheduledTime)) return;
  await buildAccountantPack(env, previousPeriod(todayIsrael()));
}
