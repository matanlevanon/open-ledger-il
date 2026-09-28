import { todayIsrael } from '../../core/db';
import type { Env } from '../../env';
import type { Currency } from '../../core/money';
import { BoiFxProvider, type FxHistoryProvider, type FxProvider } from './provider';
import { addDays, backfillRates, fetchAndCache } from './rates';

/** Must match the R04 entry in wrangler.toml's `[triggers] crons`. */
export const FX_DAILY_CRON = '0 6 * * *';

const PREFETCH_CURRENCIES: Currency[] = ['USD', 'EUR', 'GBP'];

/** Days the cron re-reads from the BOI series, so a missed run heals the next day. */
export const CRON_HEAL_DAYS = 7;

function hasHistory(provider: FxProvider): provider is FxProvider & FxHistoryProvider {
  return typeof (provider as Partial<FxHistoryProvider>).ratesBetween === 'function';
}

/**
 * Daily prefetch of USD, EUR and GBP. When the provider also serves the BOI series, the cron
 * backfills the last `CRON_HEAL_DAYS` days too, so a day the cron missed is filled in.
 * One currency's failure (BOI outage, bad response)
 * does not block the others; each failure is logged and left for the next day's run or a
 * manual `POST /api/fx/rates/fetch`. `provider` is injectable so tests never call BOI.
 */
export async function fxScheduled(
  controller: ScheduledController,
  env: Env,
  _ctx?: ExecutionContext,
  provider: FxProvider = new BoiFxProvider(),
): Promise<void> {
  if (controller.cron !== FX_DAILY_CRON) return;
  const today = todayIsrael(new Date(controller.scheduledTime));
  const results = await Promise.allSettled(
    PREFETCH_CURRENCIES.map(async (currency) => {
      // The latest rate and the healing backfill run apart, so one failing does not skip the other.
      const steps = await Promise.allSettled([
        fetchAndCache(env.DB, provider, currency, today),
        hasHistory(provider) ? backfillRates(env.DB, provider, currency, addDays(today, -CRON_HEAL_DAYS), today) : Promise.resolve(0),
      ]);
      const failed = steps.find((s) => s.status === 'rejected');
      if (failed) throw failed.reason;
    }),
  );
  for (const [i, result] of results.entries()) {
    if (result.status === 'rejected') {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error('fx.prefetch_failed', PREFETCH_CURRENCIES[i], message);
    }
  }
}
