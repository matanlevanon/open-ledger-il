import type { ModuleDef } from '../../core/module';
import type { Env } from '../../env';
import { DRIVE_DAILY_CRON } from '../expenses/drive-import';
import type { FinancyDeps } from './connection';
import { createFinancyRoutes } from './routes';
import { syncAllDaily } from './sync';

/**
 * R40: the Financy connection, bank and card data, read only. Settings > Expenses > Financy
 * connection, Expenses > Bank activity, the Financy Dashboard tab (R42), the Bank vs books report,
 * and three MCP tools. The daily sync rides on the existing daily cron, since the account is near its
 * cron limit.
 */

export { bankVsBooks, assertConnected, listBankAccounts, listBankTransactions } from './activity';
export { financyDashboard } from './dashboard';
export type { FinancyDeps } from './connection';

export function defaultFinancyDeps(): FinancyDeps {
  return { fetch: (input, init) => fetch(input, init) };
}

export function createFinancyModule(resolveDeps: (env: Env) => FinancyDeps = defaultFinancyDeps): ModuleDef {
  return {
    name: 'financy',
    basePath: '/financy',
    routes: createFinancyRoutes(resolveDeps),
    crons: [DRIVE_DAILY_CRON],
    async scheduled(controller, env) {
      if (controller.cron !== DRIVE_DAILY_CRON) return;
      await syncAllDaily(env, resolveDeps(env));
    },
  };
}

export const financyModule = createFinancyModule();
