import type { ModuleDef } from '../../core/module';
import type { Env } from '../../env';
import { SYSTEM_ACTOR } from '../../core/audit';
import { todayIsrael } from '../../core/db';
import { GoogleDriveSource } from './drive';
import { DRIVE_DAILY_CRON, runDailyDriveImport } from './drive-import';
import { AnthropicExtractor } from './extractor';
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
    extractor: new AnthropicExtractor(env),
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
      await runDailyDriveImport(env, resolveDeps(env), todayIsrael(), SYSTEM_ACTOR);
    },
  };
}

export const expensesModule = createExpensesModule();
