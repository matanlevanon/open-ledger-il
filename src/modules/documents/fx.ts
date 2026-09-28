/**
 * Exchange rates for documents come from the fx module (R04). `rateOn` is the one rate rule:
 * the rate of the date, or the last rate published before it, with Bank of Israel backfill for
 * any past date (docs/currency-and-fx.md). Documents never read `fx_rates` themselves.
 */
export { FxUnavailableError, type RateSource, type ResolvedRate, storedFxSource } from '../fx';
