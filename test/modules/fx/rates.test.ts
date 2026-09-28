import { describe, expect, it } from 'vitest';
import { first } from '../../../src/core/db';
import { ConfigError } from '../../../src/core/errors';
import { convert } from '../../../src/core/money';
import { FxUnavailableError, cacheRate, carriedRate, overrideRate, rateOn, toIlsMinor } from '../../../src/modules/fx/rates';
import { db } from '../../helpers';
import { FRIDAY, MONDAY, SATURDAY, SUNDAY } from '../../fixtures/fx/rates';

describe('fx: cache hit', () => {
  it('reads the exact cached rate for the date, without falling back', async () => {
    await cacheRate(db(), 'USD', { rate: '3.712000', rateDate: FRIDAY, source: 'boi' });
    const resolved = await rateOn(db(), 'USD', FRIDAY);
    expect(resolved).toEqual({ currency: 'USD', rate: '3.712000', rateDate: FRIDAY, requestedDate: FRIDAY, source: 'boi' });
  });

  it('replaces the cached value when the same currency and date are cached again', async () => {
    await cacheRate(db(), 'EUR', { rate: '4.000000', rateDate: FRIDAY, source: 'boi' });
    await cacheRate(db(), 'EUR', { rate: '4.100000', rateDate: FRIDAY, source: 'boi' });
    expect((await rateOn(db(), 'EUR', FRIDAY)).rate).toBe('4.100000');
    const count = await first<{ n: number }>(db(), `SELECT COUNT(*) AS n FROM fx_rates WHERE currency = 'EUR' AND rate_date = ?`, FRIDAY);
    expect(count?.n).toBe(1); // insert-or-update did not duplicate the row
  });
});

describe('fx: weekend and holiday fallback', () => {
  it('falls back to the last published rate before the date', async () => {
    await cacheRate(db(), 'USD', { rate: '3.712000', rateDate: FRIDAY, source: 'boi' });
    for (const weekendDate of [SATURDAY, SUNDAY]) {
      const resolved = await rateOn(db(), 'USD', weekendDate);
      expect(resolved).toMatchObject({ rate: '3.712000', rateDate: FRIDAY, requestedDate: weekendDate, source: 'boi_fallback' });
    }
  });

  it('prefers the exact date once it is cached, over the earlier fallback', async () => {
    await cacheRate(db(), 'GBP', { rate: '4.700000', rateDate: FRIDAY, source: 'boi' });
    await cacheRate(db(), 'GBP', { rate: '4.750000', rateDate: MONDAY, source: 'boi' });
    expect(await rateOn(db(), 'GBP', MONDAY)).toMatchObject({ rate: '4.750000', rateDate: MONDAY, source: 'boi' });
    expect(await rateOn(db(), 'GBP', SUNDAY)).toMatchObject({ rate: '4.700000', rateDate: FRIDAY, source: 'boi_fallback' });
  });

  it('throws FxUnavailableError when nothing is cached on or before the date', async () => {
    await expect(rateOn(db(), 'USD', '2020-01-01')).rejects.toBeInstanceOf(FxUnavailableError);
  });
});

describe('fx: override rate', () => {
  it('returns the typed rate labeled override, normalized to 6 decimals', () => {
    expect(overrideRate('USD', '3.7', FRIDAY)).toEqual({
      currency: 'USD',
      rate: '3.700000',
      rateDate: FRIDAY,
      requestedDate: FRIDAY,
      source: 'override',
    });
  });

  it('refuses an invalid rate string, same rule as every rate in the ledger', () => {
    expect(() => overrideRate('USD', '0', FRIDAY)).toThrow(RangeError);
    expect(() => overrideRate('USD', 'abc', FRIDAY)).toThrow(RangeError);
  });
});

describe('fx: carried rate', () => {
  it('carries the source document rate forward with its label', () => {
    const carried = carriedRate('USD', '3.712000', FRIDAY, 'PR-0088');
    expect(carried).toEqual({
      currency: 'USD',
      rate: '3.712000',
      rateDate: FRIDAY,
      requestedDate: FRIDAY,
      source: 'carried',
      carriedFrom: 'PR-0088',
    });
  });

  it('refuses a carried rate with no source label', () => {
    expect(() => carriedRate('USD', '3.712000', FRIDAY, '  ')).toThrow(ConfigError);
  });
});

describe('fx: ILS conversion rounding', () => {
  it('rounds half away from zero, matching core money rules', () => {
    const resolved = overrideRate('USD', '3.5', FRIDAY);
    // 100 minor units (1.00 USD) * 3.5 = 350 agorot exactly, no rounding needed.
    expect(toIlsMinor(100, resolved)).toBe(convert(100, '3.500000'));
    // An amount that lands on an exact half-agora rounds up in size.
    const half = overrideRate('USD', '3.005', FRIDAY);
    expect(toIlsMinor(100, half)).toBe(convert(100, '3.005000'));
  });
});
