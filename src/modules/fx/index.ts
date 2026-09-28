import type { ModuleDef } from '../../core/module';
import { FX_DAILY_CRON, fxScheduled } from './cron';
import { BoiFxProvider } from './provider';
import { type FxRouteDeps, createFxRoutes } from './routes';

/** Builds the fx module. Tests pass fake providers, so no test calls the Bank of Israel. */
export function createFxModule(deps: Partial<FxRouteDeps> = {}): ModuleDef {
  return {
    name: 'fx',
    basePath: '/fx',
    routes: createFxRoutes({
      current: deps.current ?? (() => new BoiFxProvider()),
      history: deps.history ?? (() => new BoiFxProvider()),
    }),
    crons: [FX_DAILY_CRON],
    scheduled: fxScheduled,
  };
}

export const fxModule = createFxModule();

export {
  BoiFxProvider,
  FakeFxHistory,
  FakeFxProvider,
  FxProviderError,
  type FxHistoryProvider,
  type FxProvider,
  type FxRate,
} from './provider';
export {
  FxUnavailableError,
  backfillRates,
  cacheRate,
  carriedRate,
  fetchAndCache,
  overrideRate,
  rateOn,
  recentRates,
  toIlsMinor,
  type ResolvedRate,
} from './rates';
export { FxRates, boiRateSource, storedFxSource, type RateSource } from './source';
export { FX_DAILY_CRON } from './cron';
