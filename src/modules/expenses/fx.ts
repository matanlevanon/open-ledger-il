import { type Currency, HOME_CURRENCY, convert, normalizeRate } from '../../core/money';
import { FxUnavailableError, type RateSource, storedFxSource, toIlsMinor } from '../fx';

/**
 * Converts an expense to ILS at the document date through the fx module (R04). `rateOn` is the
 * one rate rule: the rate of the date, or the last rate published before it, with Bank of
 * Israel backfill for any past date (docs/currency-and-fx.md). Expenses never read `fx_rates`.
 */
export type { RateSource };

export interface IlsConversion {
  amountIlsMinor: number | null;
  fxRate: string | null;
  fxRateDate: string | null;
  fxSource: string | null;
}

/** Converts an amount in minor units to ILS at the document date. Null when no rate exists yet. */
export async function convertToIls(
  rates: RateSource,
  currency: Currency,
  date: string,
  amountMinor: number,
): Promise<IlsConversion> {
  if (currency === HOME_CURRENCY) return { amountIlsMinor: amountMinor, fxRate: null, fxRateDate: null, fxSource: null };
  let found;
  try {
    found = await rates.rateFor(currency, date);
  } catch (err) {
    if (err instanceof FxUnavailableError) return { amountIlsMinor: null, fxRate: null, fxRateDate: null, fxSource: null };
    throw err;
  }
  return {
    amountIlsMinor: toIlsMinor(amountMinor, found),
    fxRate: found.rate,
    fxRateDate: found.rateDate,
    fxSource: storedFxSource(found.source),
  };
}

/** Manual override: the user types a rate directly (docs/currency-and-fx.md "Override rate"). */
export function convertWithRate(amountMinor: number, rate: string): IlsConversion {
  const normalized = normalizeRate(rate);
  return {
    amountIlsMinor: convert(amountMinor, normalized),
    fxRate: normalized,
    fxRateDate: null,
    fxSource: 'manual',
  };
}
