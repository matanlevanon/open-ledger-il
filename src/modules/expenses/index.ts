import type { ModuleDef } from '../../core/module';
import type { Env } from '../../env';
import { systemActorFor } from '../../core/audit';
import { listBusinessIds } from '../../core/business';
import { todayIsrael } from '../../core/db';
import { GoogleDriveSource } from './drive';
import { DRIVE_DAILY_CRON, runDailyDriveImport } from './drive-import';
import { AiExtractor } from './extractor';
import { boiRateSource } from '../fx';
import { createExpensesRoutes } from './routes';
import { type Deps, type RereadBatch, retryUnreadExpenses } from './service';

export * as expensesService from './service';
export * from './types';
export type { DriveSource, DriveFile } from './drive';
export type { Extractor, ExtractInput } from './extractor';
export type { RateSource } from './fx';
export type { Deps as ExpensesDeps } from './service';
export { DRIVE_DAILY_CRON, importMonth, runDailyDriveImport } from './drive-import';

export function defaultDeps(env: Env): Deps {
  return {
    drive: new GoogleDriveSource(env),
    extractor: new AiExtractor(env),
    fx: boiRateSource(env.DB),
  };
}

/** R39: the daily retry of unread expenses in every business, with one log line for the run. Never throws. */
export async function retryUnreadDaily(env: Env, deps: Deps, businessIds: number[]): Promise<RereadBatch> {
  const total: RereadBatch = { tried: 0, read: 0, failed: 0, stoppedBusy: false };
  for (const businessId of businessIds) {
    try {
      const batch = await retryUnreadExpenses(env, deps, systemActorFor(businessId));
      total.tried += batch.tried;
      total.read += batch.read;
      total.failed += batch.failed;
      total.stoppedBusy ||= batch.stoppedBusy;
    } catch (err) {
      console.error('expense.reread_daily_failed', businessId, err instanceof Error ? err.message : 'unknown');
    }
  }
  console.log('expense.reread_daily', { tried: total.tried, read: total.read, stillFailed: total.failed, stoppedBusy: total.stoppedBusy });
  return total;
}

/** Builds the expenses module. Tests pass `resolveDeps` returning fakes (runs/_common.md). */
export function createExpensesModule(resolveDeps: (env: Env) => Deps = defaultDeps): ModuleDef {
  return {
    name: 'expenses',
    basePath: '/expenses',
    routes: createExpensesRoutes(resolveDeps),
    crons: [DRIVE_DAILY_CRON],
    async scheduled(controller, env) {
      if (controller.cron !== DRIVE_DAILY_CRON) return;
      const businessIds = await listBusinessIds(env.DB);
      try {
        // R24: each business imports from its own Drive folder, when its daily sync is on.
        for (const businessId of businessIds) {
          await runDailyDriveImport(env, resolveDeps(env), todayIsrael(), systemActorFor(businessId));
        }
      } finally {
        // R39: on the same daily cron, unread expenses get another read. The account is near its cron limit.
        await retryUnreadDaily(env, resolveDeps(env), businessIds);
      }
    },
  };
}

export const expensesModule = createExpensesModule();
