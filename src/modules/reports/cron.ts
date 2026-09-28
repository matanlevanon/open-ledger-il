import { todayIsrael } from '../../core/db';
import type { Env } from '../../env';
import { buildAccountantPack, previousPeriod } from './pack';

/** 5th of every month (docs/accountant-access.md "Monthly pack"). Must match wrangler.toml's `[triggers] crons`. */
export const ACCOUNTANT_PACK_CRON = '0 7 5 * *';

export async function reportsScheduled(controller: ScheduledController, env: Env, _ctx?: ExecutionContext): Promise<void> {
  if (controller.cron !== ACCOUNTANT_PACK_CRON) return;
  await buildAccountantPack(env, previousPeriod(todayIsrael()));
}
