import { all, assertDate, first, nowIso, run } from '../../core/db';
import { ConfigError, ConflictError, ValidationError } from '../../core/errors';
import { assertCurrency, convert, type Currency, HOME_CURRENCY, normalizeRate } from '../../core/money';
import type { FxHistoryProvider, FxProvider, FxRate } from './provider';

/**
 * Rate resolution for documents and expenses (docs/currency-and-fx.md). `rateOn` is the one
 * rate rule in the ledger. `fx_rates` is the cache the daily cron fills (`cron.ts`). When the
 * exact date is not cached and a history provider is passed, `rateOn` backfills the Bank of
 * Israel series for the days before the date, then resolves from the cache. It falls back to
 * the last published rate before the date, or accepts a rate someone typed by hand.
 * `fetchAndCache` and `backfillRates` are the only places that call a provider.
 */

export interface FxRateRow {
  currency: string;
  rate_date: string;
  rate: string;
  source: string;
  fetched_at: string;
}

export interface ResolvedRate {
  currency: Currency;
  rate: string;
  /** The date the rate was actually published for. Equals `requestedDate` except on fallback. */
  rateDate: string;
  requestedDate: string;
  source: 'ils' | 'boi' | 'boi_fallback' | 'override' | 'carried';
  /** Set only for a carried rate: a label for the document the rate was carried from. */
  carriedFrom?: string;
}

/** Writes one cached BOI rate. Re-fetching the same (currency, date) replaces the value. */
export async function cacheRate(db: D1Database, currency: Currency, rate: FxRate): Promise<void> {
  assertCurrency(currency);
  assertDate(rate.rateDate, 'rateDate');
  await run(
    db,
    `INSERT INTO fx_rates (currency, rate_date, rate, source, fetched_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (currency, rate_date, source) DO UPDATE SET rate = excluded.rate, fetched_at = excluded.fetched_at`,
    currency,
    rate.rateDate,
    normalizeRate(rate.rate),
    rate.source,
    nowIso(),
  );
}

async function cachedBoiRate(db: D1Database, currency: Currency, date: string): Promise<FxRateRow | null> {
  return first<FxRateRow>(db, `SELECT * FROM fx_rates WHERE currency = ? AND rate_date = ? AND source = 'boi'`, currency, date);
}

/** docs/currency-and-fx.md: "the last rate published before the payment date". */
async function lastBoiRateBefore(db: D1Database, currency: Currency, date: string): Promise<FxRateRow | null> {
  return first<FxRateRow>(
    db,
    `SELECT * FROM fx_rates WHERE currency = ? AND rate_date <= ? AND source = 'boi' ORDER BY rate_date DESC LIMIT 1`,
    currency,
    date,
  );
}

/** No rate is published on or before the date, and backfill could not find one. */
export class FxUnavailableError extends ConflictError {
  constructor(currency: string, date: string) {
    super('fx_unavailable', `No ${currency} rate is published on or before ${date}. Add the rate, then try again.`);
  }
}

/** Days `rateOn` backfills before a date it has no exact rate for. Covers the longest holiday gap. */
export const BACKFILL_LOOKBACK_DAYS = 14;
/** Longest range one backfill call accepts. */
export const BACKFILL_MAX_DAYS = 366;

export function addDays(date: string, days: number): string {
  const d = new Date(`${assertDate(date)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Fetches the Bank of Israel series for `[from, to]` and caches every published day.
 * Works for any past date. Returns the number of days cached.
 */
export async function backfillRates(
  db: D1Database,
  history: FxHistoryProvider,
  currency: Currency,
  from: string,
  to: string,
): Promise<number> {
  assertCurrency(currency);
  if (currency === HOME_CURRENCY) throw new ValidationError('ILS has no exchange rate to backfill.');
  assertDate(from, 'from');
  assertDate(to, 'to');
  if (from > to) throw new ValidationError('The backfill start date must be on or before the end date.');
  if (daysBetween(from, to) > BACKFILL_MAX_DAYS) throw new ValidationError(`Backfill at most ${BACKFILL_MAX_DAYS} days at a time.`);
  const rates = await history.ratesBetween(currency, from, to);
  for (const rate of rates) await cacheRate(db, currency, rate);
  return rates.length;
}

export interface RateOnOptions {
  /** Backfills the Bank of Israel series on a cache miss. Omit for a cache-only read. */
  history?: FxHistoryProvider;
}

/**
 * The rate to use for `date`: the BOI rate for that exact date, or the closest published rate
 * before it (weekend, holiday, before publication). docs/currency-and-fx.md "Rate source and date".
 * On a cache miss with `history`, backfills the days before `date` first, so any past date resolves.
 * A failed backfill is logged and the cache answers. Throws `FxUnavailableError` when no rate exists.
 */
export async function rateOn(db: D1Database, currency: Currency, date: string, options: RateOnOptions = {}): Promise<ResolvedRate> {
  assertCurrency(currency);
  assertDate(date);
  if (currency === HOME_CURRENCY) return { currency, rate: '1.000000', rateDate: date, requestedDate: date, source: 'ils' };
  const exact = await cachedBoiRate(db, currency, date);
  if (exact) return { currency, rate: normalizeRate(exact.rate), rateDate: exact.rate_date, requestedDate: date, source: 'boi' };

  if (options.history) {
    try {
      await backfillRates(db, options.history, currency, addDays(date, -BACKFILL_LOOKBACK_DAYS), date);
    } catch (err) {
      console.error('fx.backfill_failed', currency, date, err instanceof Error ? err.message : String(err));
    }
    const filled = await cachedBoiRate(db, currency, date);
    if (filled) return { currency, rate: normalizeRate(filled.rate), rateDate: filled.rate_date, requestedDate: date, source: 'boi' };
  }

  const fallback = await lastBoiRateBefore(db, currency, date);
  if (!fallback) throw new FxUnavailableError(currency, date);
  return { currency, rate: normalizeRate(fallback.rate), rateDate: fallback.rate_date, requestedDate: date, source: 'boi_fallback' };
}

/** Recent cached rates for a currency, newest first. For the settings screen and admin checks. */
export async function recentRates(db: D1Database, currency: Currency, limit = 30): Promise<FxRateRow[]> {
  assertCurrency(currency);
  return all<FxRateRow>(
    db,
    `SELECT * FROM fx_rates WHERE currency = ? AND source = 'boi' ORDER BY rate_date DESC LIMIT ?`,
    currency,
    limit,
  );
}

/** A rate someone types by hand: docs/currency-and-fx.md "Override rate" / "Agreed rate". */
export function overrideRate(currency: Currency, rate: string, date: string): ResolvedRate {
  assertCurrency(currency);
  assertDate(date);
  return { currency, rate: normalizeRate(rate), rateDate: date, requestedDate: date, source: 'override' };
}

/**
 * Carries the rate frozen on a source document forward to a new one:
 * docs/currency-and-fx.md "Carry rate to receipt". `sourceLabel` is a document reference
 * such as "PR-0088", printed on the new document as the rate source.
 */
export function carriedRate(currency: Currency, rate: string, rateDate: string, sourceLabel: string): ResolvedRate {
  assertCurrency(currency);
  assertDate(rateDate, 'rateDate');
  if (!sourceLabel.trim()) throw new ConfigError('A carried rate needs the label of the document it was carried from.');
  return { currency, rate: normalizeRate(rate), rateDate, requestedDate: rateDate, source: 'carried', carriedFrom: sourceLabel };
}

/** Fetches the live BOI rate through `provider` and caches it. Used by the daily cron and manual refresh. */
export async function fetchAndCache(db: D1Database, provider: FxProvider, currency: Currency, date: string): Promise<ResolvedRate> {
  assertCurrency(currency);
  assertDate(date);
  const fetched = await provider.rateFor(currency, date);
  await cacheRate(db, currency, fetched);
  return { currency, rate: normalizeRate(fetched.rate), rateDate: fetched.rateDate, requestedDate: date, source: 'boi' };
}

/** Converts a foreign amount to ILS minor units using a resolved rate (money.ts rounding rule). */
export function toIlsMinor(amountMinor: number, resolved: Pick<ResolvedRate, 'rate'>): number {
  return convert(amountMinor, resolved.rate);
}
