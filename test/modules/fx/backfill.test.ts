import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { all, run } from '../../../src/core/db';
import { FX_DAILY_CRON, fxScheduled } from '../../../src/modules/fx/cron';
import {
  BoiFxProvider,
  FakeFxHistory,
  type FxHistoryProvider,
  type FxProvider,
  FxProviderError,
  type FxRate,
  parseBoiSeriesCsv,
} from '../../../src/modules/fx/provider';
import { BACKFILL_LOOKBACK_DAYS, FxUnavailableError, backfillRates, cacheRate, rateOn } from '../../../src/modules/fx/rates';
import { FxRates } from '../../../src/modules/fx/source';

// Storage is isolated per test file, not per test, so each test clears the cache it shares.
beforeEach(async () => {
  await run(env.DB, 'DELETE FROM fx_rates');
});

const SERIES_CSV = [
  'SERIES_CODE,FREQ,BASE_CURRENCY,COUNTER_CURRENCY,UNIT_MEASURE,DATA_TYPE,COMMENTS,TIME_PERIOD,OBS_VALUE',
  'RER_USD_ILS,D,USD,ILS,ILS,OF00,"Representative rate, daily",2023-03-02,3.612',
  'RER_USD_ILS,D,USD,ILS,ILS,OF00,,2023-03-05,3.6195',
  'RER_USD_ILS,D,USD,ILS,ILS,OF00,,2023-03-01,3.59',
].join('\r\n');

describe('fx backfill: Bank of Israel series parsing', () => {
  it('reads TIME_PERIOD and OBS_VALUE by header name, oldest first, 6 decimals', () => {
    expect(parseBoiSeriesCsv('USD', SERIES_CSV)).toEqual([
      { rate: '3.590000', rateDate: '2023-03-01', source: 'boi' },
      { rate: '3.612000', rateDate: '2023-03-02', source: 'boi' },
      { rate: '3.619500', rateDate: '2023-03-05', source: 'boi' },
    ]);
  });

  it('refuses a series without the date or value column', () => {
    expect(() => parseBoiSeriesCsv('USD', 'A,B\n1,2')).toThrow(FxProviderError);
  });

  it('asks BoiFxProvider.ratesBetween for the RER series of the currency and the range', async () => {
    let url = '';
    const provider = new BoiFxProvider((async (input: string | URL | Request) => {
      url = String(input);
      return new Response(SERIES_CSV, { status: 200 });
    }) as typeof fetch);
    const rates = await provider.ratesBetween('USD', '2023-03-01', '2023-03-02');
    expect(url).toContain('/RER_USD_ILS?startperiod=2023-03-01&endperiod=2023-03-02&format=csv');
    expect(rates.map((r) => r.rateDate)).toEqual(['2023-03-01', '2023-03-02']);
  });

  it('raises FxProviderError when the series API fails', async () => {
    const provider = new BoiFxProvider((async () => new Response('', { status: 500 })) as unknown as typeof fetch);
    await expect(provider.ratesBetween('USD', '2023-03-01', '2023-03-02')).rejects.toBeInstanceOf(FxProviderError);
  });
});

describe('fx backfill: any past date resolves through rateOn', () => {
  it('backfills an uncached past date and returns the rate of that date', async () => {
    const history = new FakeFxHistory({ USD: { '2019-05-14': '3.570000', '2019-05-15': '3.580000' } });
    const resolved = await rateOn(env.DB, 'USD', '2019-05-15', { history });
    expect(resolved).toEqual({ currency: 'USD', rate: '3.580000', rateDate: '2019-05-15', requestedDate: '2019-05-15', source: 'boi' });
    expect(history.calls).toEqual([{ currency: 'USD', from: '2019-05-01', to: '2019-05-15' }]);
    expect(BACKFILL_LOOKBACK_DAYS).toBe(14);
  });

  it('backfills the days before a weekend date so the fallback is the last published rate', async () => {
    const history = new FakeFxHistory({ EUR: { '2021-01-07': '3.900000', '2021-01-08': '3.910000' } });
    const resolved = await rateOn(env.DB, 'EUR', '2021-01-09', { history });
    expect(resolved).toMatchObject({ rate: '3.910000', rateDate: '2021-01-08', source: 'boi_fallback' });
  });

  it('never calls the provider on a cache hit', async () => {
    await cacheRate(env.DB, 'GBP', { rate: '4.500000', rateDate: '2022-02-02', source: 'boi' });
    const history = new FakeFxHistory({});
    expect((await rateOn(env.DB, 'GBP', '2022-02-02', { history })).rate).toBe('4.500000');
    expect(history.calls).toHaveLength(0);
  });

  it('answers from the cache when the backfill fails, and throws FxUnavailableError when the cache is empty', async () => {
    const down = new FakeFxHistory({}, new FxProviderError('BOI down'));
    await cacheRate(env.DB, 'USD', { rate: '3.700000', rateDate: '2026-10-01', source: 'boi' });
    expect(await rateOn(env.DB, 'USD', '2026-10-03', { history: down })).toMatchObject({ rate: '3.700000', source: 'boi_fallback' });
    await expect(rateOn(env.DB, 'EUR', '2026-10-03', { history: down })).rejects.toBeInstanceOf(FxUnavailableError);
  });

  it('gives ILS a rate of one without a lookup', async () => {
    const history = new FakeFxHistory({});
    expect(await new FxRates(env.DB, history).rateFor('ILS', '2026-10-03')).toMatchObject({ rate: '1.000000', source: 'ils' });
    expect(history.calls).toHaveLength(0);
  });

  it('backfillRates caches every published day in the range and refuses a bad range', async () => {
    const history = new FakeFxHistory({ USD: { '2018-01-02': '3.46', '2018-01-03': '3.47', '2018-02-01': '3.40' } });
    expect(await backfillRates(env.DB, history, 'USD', '2018-01-01', '2018-01-31')).toBe(2);
    const rows = await all<{ rate_date: string }>(env.DB, `SELECT rate_date FROM fx_rates WHERE currency = 'USD' ORDER BY rate_date`);
    expect(rows.map((r) => r.rate_date)).toEqual(['2018-01-02', '2018-01-03']);
    await expect(backfillRates(env.DB, history, 'USD', '2018-02-01', '2018-01-01')).rejects.toMatchObject({ code: 'validation_error' });
    await expect(backfillRates(env.DB, history, 'ILS', '2018-01-01', '2018-01-31')).rejects.toMatchObject({ code: 'validation_error' });
  });
});

describe('fx backfill: the daily cron is kept and heals missed days', () => {
  class LiveAndSeries implements FxProvider, FxHistoryProvider {
    readonly series = new FakeFxHistory({ USD: { '2026-09-28': '3.690000', '2026-09-29': '3.695000' } });
    async rateFor(): Promise<FxRate> {
      return { rate: '3.700000', rateDate: '2026-10-02', source: 'boi' };
    }
    ratesBetween(currency: 'USD' | 'EUR' | 'GBP' | 'ILS', from: string, to: string) {
      return this.series.ratesBetween(currency, from, to);
    }
  }

  it('fetches the latest rate and backfills the last 7 days', async () => {
    const provider = new LiveAndSeries();
    const controller = { cron: FX_DAILY_CRON, scheduledTime: Date.parse('2026-10-02T06:00:00Z'), noRetry() {} } as ScheduledController;
    await fxScheduled(controller, env, undefined, provider);
    const usd = await all<{ rate_date: string }>(env.DB, `SELECT rate_date FROM fx_rates WHERE currency = 'USD' ORDER BY rate_date`);
    expect(usd.map((r) => r.rate_date)).toEqual(['2026-09-28', '2026-09-29', '2026-10-02']);
    expect(provider.series.calls.find((c) => c.currency === 'USD')).toEqual({ currency: 'USD', from: '2026-09-25', to: '2026-10-02' });
  });
});
