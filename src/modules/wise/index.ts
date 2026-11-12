import type { ModuleDef } from '../../core/module';
import type { Env } from '../../env';
import { DRIVE_DAILY_CRON } from '../expenses/drive-import';
import type { WiseDeps } from './connection';
import { createWiseRoutes } from './routes';
import { syncAllWiseDaily } from './sync';

/**
 * R49: the Wise Business connection, read only. Settings > Expenses > Wise connection. The
 * balances and their rows show in Expenses > Bank activity and the bank dashboard next to the
 * Financy accounts, and money in is matched to an open payment request. Wise tells the Ledger
 * about money in through a webhook (./hook.ts), and the daily sync rides on the existing daily cron.
 */

export type { WiseDeps } from './connection';
export { createWiseHookRoutes } from './hook';

export function defaultWiseDeps(): WiseDeps {
  return { fetch: (input, init) => fetch(input, init) };
}

export function createWiseModule(resolveDeps: (env: Env) => WiseDeps = defaultWiseDeps): ModuleDef {
  return {
    name: 'wise',
    basePath: '/wise',
    routes: createWiseRoutes(resolveDeps),
    crons: [DRIVE_DAILY_CRON],
    async scheduled(controller, env) {
      if (controller.cron !== DRIVE_DAILY_CRON) return;
      await syncAllWiseDaily(env, resolveDeps(env));
    },
  };
}

export const wiseModule = createWiseModule();
