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
import type { Deps } from './service';

export * as expensesService from './service';
export * from './types';
export type { DriveSource, DriveFile } from './drive';
export type { Extractor, ExtractInput } from './extractor';
export type { RateSource } from './fx';
export type { Deps as ExpensesDeps } from './service';
export { DRIVE_DAILY_CRON, importMonth, runDailyDriveImport } from './drive-import';

function defaultDeps(env: Env): Deps {
  return {
    drive: new GoogleDriveSource(env),
    extractor: new AiExtractor(env),
    fx: boiRateSource(env.DB),
  };
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
      // R24: each business imports from its own Drive folder, when its daily sync is on.
      for (const businessId of await listBusinessIds(env.DB)) {
        await runDailyDriveImport(env, resolveDeps(env), todayIsrael(), systemActorFor(businessId));
      }
    },
  };
}

export const expensesModule = createExpensesModule();
