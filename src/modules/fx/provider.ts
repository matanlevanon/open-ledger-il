import { assertDate } from '../../core/db';
import { DomainError } from '../../core/errors';
import { RATE_DECIMALS, assertCurrency, type Currency, normalizeRate } from '../../core/money';

/**
 * `FxProvider`: one Bank of Israel representative rate for one currency and date.
 * `rate` and `rateDate` can differ from the date asked for: the BOI publishes on trading
 * days only, so a request for a weekend or holiday date resolves through the cache fallback
 * in `rates.ts`, not here. A provider always returns the rate it actually has.
 */
export interface FxRate {
  /** 6-decimal string, ILS per one unit of the currency (money.ts rate format). */
  rate: string;
  /** YYYY-MM-DD, the date the returned rate was published for. */
  rateDate: string;
  source: string;
}

export interface FxProvider {
  rateFor(currency: Currency, date: string): Promise<FxRate>;
}

/**
 * Published rates for a past date range, for backfill. Returns one entry per publication day
 * in `[from, to]`, oldest first. Days with no publication (weekends, holidays) are absent.
 */
export interface FxHistoryProvider {
  ratesBetween(currency: Currency, from: string, to: string): Promise<FxRate[]>;
}

export class FxProviderError extends DomainError {
  constructor(message: string) {
    super('fx_provider_error', message, 502);
  }
}

/**
 * Bank of Israel public API, no key required.
 * `GET https://boi.org.il/PublicApi/GetExchangeRate?key=<CCY>` returns the current
 * representative rate as JSON: `{"key":"USD","currentExchangeRate":3.712,"unit":1,"lastUpdate":"2026-10-02T13:45:...Z"}`.
 * `unit` divides in for currencies quoted per 100 (for example JPY); USD, EUR and GBP are unit 1.
 * This endpoint only ever answers with the latest published rate, never a rate for an
 * arbitrary past date, so it is called once a day by the cron in `cron.ts` and the result is
 * cached in `fx_rates`. Historical dates are served from that cache, see `rates.ts`.
 * Documented in `docs/progress.md`.
 */
const BOI_ENDPOINT = 'https://boi.org.il/PublicApi/GetExchangeRate';

/**
 * Bank of Israel SDMX series for historical representative rates, no key required.
 * `GET <base>/RER_<CCY>_ILS?startperiod=YYYY-MM-DD&endperiod=YYYY-MM-DD&format=csv` returns one
 * CSV row per publication day with `TIME_PERIOD` (the date) and `OBS_VALUE` (ILS per unit).
 * Used by `rates.ts` to backfill any past date. Documented in `docs/progress.md`.
 */
const BOI_SERIES_ENDPOINT = 'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0';

/** Splits one CSV line. Handles double-quoted fields with commas and doubled quotes. */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

/** Parses the SDMX CSV answer into rates. Exported for tests. */
export function parseBoiSeriesCsv(currency: Currency, csv: string): FxRate[] {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = csvFields(lines[0]!).map((h) => h.toUpperCase());
  const dateCol = header.indexOf('TIME_PERIOD');
  const valueCol = header.indexOf('OBS_VALUE');
  if (dateCol < 0 || valueCol < 0) {
    throw new FxProviderError(`Bank of Israel series for ${currency} has no TIME_PERIOD or OBS_VALUE column.`);
  }
  const out: FxRate[] = [];
  for (const line of lines.slice(1)) {
    const fields = csvFields(line);
    const rateDate = fields[dateCol]?.slice(0, 10) ?? '';
    const value = fields[valueCol] ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rateDate) || value === '' || value.toUpperCase() === 'NAN') continue;
    let rate: string;
    try {
      rate = normalizeRate(value);
    } catch {
      throw new FxProviderError(`Bank of Israel series for ${currency} has a rate that is not a number on ${rateDate}.`);
    }
    out.push({ rate, rateDate, source: 'boi' });
  }
  return out.sort((a, b) => a.rateDate.localeCompare(b.rateDate));
}

interface BoiRateResponse {
  key?: string;
  currentExchangeRate?: number;
  unit?: number;
  lastUpdate?: string;
}

export class BoiFxProvider implements FxProvider, FxHistoryProvider {
  // Wrapped: a bare `fetch` stored on an object and called as this.fetchImpl() throws "Illegal invocation" on Workers.
  constructor(private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init)) {}

  async ratesBetween(currency: Currency, from: string, to: string): Promise<FxRate[]> {
    assertCurrency(currency);
    assertDate(from, 'from');
    assertDate(to, 'to');
    const url = `${BOI_SERIES_ENDPOINT}/RER_${currency}_ILS?startperiod=${from}&endperiod=${to}&format=csv`;
    let res: Response;
    try {
      res = await this.fetchImpl(url);
    } catch (err) {
      throw new FxProviderError(
        `Could not reach the Bank of Israel series API for ${currency}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok) throw new FxProviderError(`Bank of Israel series API returned ${res.status} for ${currency}.`);
    return parseBoiSeriesCsv(currency, await res.text()).filter((r) => r.rateDate >= from && r.rateDate <= to);
  }

  async rateFor(currency: Currency, date: string): Promise<FxRate> {
    assertCurrency(currency);
    assertDate(date);
    let res: Response;
    try {
      res = await this.fetchImpl(`${BOI_ENDPOINT}?key=${currency}`);
    } catch (err) {
      throw new FxProviderError(
        `Could not reach the Bank of Israel API for ${currency}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok) throw new FxProviderError(`Bank of Israel API returned ${res.status} for ${currency}.`);
    let body: BoiRateResponse;
    try {
      body = await res.json();
    } catch {
      throw new FxProviderError(`Bank of Israel API returned a response that is not JSON for ${currency}.`);
    }
    if (typeof body.currentExchangeRate !== 'number' || !Number.isFinite(body.currentExchangeRate) || typeof body.lastUpdate !== 'string') {
      throw new FxProviderError(`Bank of Israel API returned an unexpected response for ${currency}.`);
    }
    const unit = body.unit && body.unit > 0 ? body.unit : 1;
    const rateDate = body.lastUpdate.slice(0, 10);
    assertDate(rateDate);
    return { rate: normalizeRate((body.currentExchangeRate / unit).toFixed(RATE_DECIMALS)), rateDate, source: 'boi' };
  }
}

/** Fixture rates for tests. Tests never call BOI (runs/_common.md). */
export type FakeRates = Partial<Record<Currency, FxRate | ((date: string) => FxRate)>>;

export class FakeFxProvider implements FxProvider {
  constructor(private readonly rates: FakeRates) {}

  async rateFor(currency: Currency, date: string): Promise<FxRate> {
    assertCurrency(currency);
    assertDate(date);
    const entry = this.rates[currency];
    if (!entry) throw new FxProviderError(`No fixture rate for ${currency}.`);
    return typeof entry === 'function' ? entry(date) : entry;
  }
}

/** Fixture history for tests: `{ USD: { '2026-10-01': '3.700000' } }`. Records every call. */
export class FakeFxHistory implements FxHistoryProvider {
  readonly calls: { currency: Currency; from: string; to: string }[] = [];

  constructor(
    private readonly table: Partial<Record<Currency, Record<string, string>>>,
    private readonly failWith?: Error,
  ) {}

  async ratesBetween(currency: Currency, from: string, to: string): Promise<FxRate[]> {
    this.calls.push({ currency, from, to });
    if (this.failWith) throw this.failWith;
    return Object.entries(this.table[currency] ?? {})
      .filter(([d]) => d >= from && d <= to)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([rateDate, rate]) => ({ rate: normalizeRate(rate), rateDate, source: 'boi' }));
  }
}
