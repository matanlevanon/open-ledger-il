import type { Currency } from '../../core/money';
import { BoiFxProvider, type FxHistoryProvider } from './provider';
import { type ResolvedRate, rateOn } from './rates';

/**
 * The one exchange-rate source for the ledger. Documents (R01) and expenses (R07) take a
 * `RateSource` and never read `fx_rates` themselves. Every lookup runs through `rateOn`.
 */
export interface RateSource {
  rateFor(currency: Currency, date: string): Promise<ResolvedRate>;
}

/** `rateOn` over the `fx_rates` cache, with Bank of Israel backfill for any past date. */
export class FxRates implements RateSource {
  constructor(
    private readonly db: D1Database,
    private readonly history?: FxHistoryProvider,
  ) {}

  rateFor(currency: Currency, date: string): Promise<ResolvedRate> {
    return rateOn(this.db, currency, date, { history: this.history });
  }
}

/** Production wiring: the cache plus the live Bank of Israel series. */
export function boiRateSource(db: D1Database): RateSource {
  return new FxRates(db, new BoiFxProvider());
}

/** `fx_source` stored on a payment or expense. A fallback is still a BOI rate, and its rate date names the day. */
export function storedFxSource(source: ResolvedRate['source']): string {
  return source === 'boi_fallback' ? 'boi' : source;
}
