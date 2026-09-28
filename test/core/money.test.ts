import { describe, expect, it } from 'vitest';
import {
  convert,
  divRound,
  formatMinor,
  formatRate,
  isCurrency,
  normalizeRate,
  parseMajor,
  parseRate,
  percentOf,
  sumMinor,
} from '../../src/core/money';

describe('money: rates are 6-decimal strings, never floats', () => {
  it('parses and normalizes rates', () => {
    expect(parseRate('3.712')).toBe(3_712_000n);
    expect(parseRate('3.712000')).toBe(3_712_000n);
    expect(parseRate('4')).toBe(4_000_000n);
    expect(normalizeRate('3.7')).toBe('3.700000');
    expect(formatRate(1n)).toBe('0.000001');
  });

  it('rejects zero, negative, too many decimals and junk', () => {
    for (const bad of ['0', '0.000000', '-3.7', '3.7123456', 'abc', '', '3,7', '1e3']) {
      expect(() => parseRate(bad), bad).toThrow();
    }
  });
});

describe('money: convert foreign minor units to ILS minor units', () => {
  it('converts exactly when no rounding is needed', () => {
    expect(convert(100_00, '3.712000')).toBe(371_20);
    expect(convert(0, '3.712000')).toBe(0);
  });

  it('rounds an exact half away from zero', () => {
    // 1 cent × 0.5 = 0.5 agora -> 1. 3 cents × 0.5 = 1.5 -> 2. 5 × 0.5 = 2.5 -> 3.
    expect(convert(1, '0.5')).toBe(1);
    expect(convert(3, '0.5')).toBe(2);
    expect(convert(5, '0.5')).toBe(3);
    expect(convert(7, '0.5')).toBe(4);
  });

  it('rounds non-half fractions to nearest', () => {
    // 123_45 × 3.654321 = 45112.59... agorot -> 45113
    expect(convert(123_45, '3.654321')).toBe(45113);
    // 1 × 3.333333 = 3.333333 -> 3
    expect(convert(1, '3.333333')).toBe(3);
  });

  it('rounds credits symmetrically, half away from zero', () => {
    expect(convert(-1, '0.5')).toBe(-1);
    expect(convert(-3, '0.5')).toBe(-2);
    expect(convert(-5, '0.5')).toBe(-3);
    expect(convert(-123_45, '3.654321')).toBe(-45113);
  });

  it('refuses float and unsafe amounts', () => {
    expect(() => convert(10.5, '3.7')).toThrow(RangeError);
    expect(() => convert(Number.MAX_SAFE_INTEGER + 1, '3.7')).toThrow(RangeError);
  });

  it('refuses a result that overflows a safe integer', () => {
    expect(() => convert(Number.MAX_SAFE_INTEGER, '999999.999999')).toThrow(RangeError);
  });

  it('never drifts on large amounts', () => {
    // 1,000,000,000.00 USD at 3.712345 = 3,712,345,000.00 ILS exactly.
    expect(convert(1_000_000_000_00, '3.712345')).toBe(3_712_345_000_00);
  });
});

describe('money: helpers', () => {
  it('divRound handles exact, below and above half', () => {
    expect(divRound(10n, 5n)).toBe(2n);
    expect(divRound(12n, 10n)).toBe(1n);
    expect(divRound(18n, 10n)).toBe(2n);
    expect(divRound(25n, 10n)).toBe(3n);
    expect(divRound(35n, 10n)).toBe(4n);
    expect(divRound(-25n, 10n)).toBe(-3n);
    expect(divRound(14n, 10n)).toBe(1n);
    expect(divRound(-14n, 10n)).toBe(-1n);
    expect(() => divRound(1n, 0n)).toThrow();
  });

  it('percentOf applies basis points (VAT from the rate table)', () => {
    expect(percentOf(100_00, 1800)).toBe(18_00);
    expect(percentOf(333, 1800)).toBe(60); // 59.94
    expect(percentOf(25, 2000)).toBe(5);
    expect(percentOf(1, 5000)).toBe(1); // 0.5 -> 1 (half away from zero)
    expect(percentOf(-1, 5000)).toBe(-1);
    expect(() => percentOf(100, -1)).toThrow();
  });

  it('parses and formats major units without floats', () => {
    expect(parseMajor('1,234.56', 'ILS')).toBe(123456);
    expect(parseMajor('0.1', 'USD')).toBe(10);
    expect(parseMajor('-5', 'EUR')).toBe(-500);
    expect(() => parseMajor('1.234', 'ILS')).toThrow();
    expect(formatMinor(123456, 'ILS')).toBe('1,234.56');
    expect(formatMinor(-5, 'USD')).toBe('-0.05');
    expect(formatMinor(100000000, 'GBP')).toBe('1,000,000.00');
  });

  it('sums safely and knows the currency list', () => {
    expect(sumMinor([1, 2, 3])).toBe(6);
    expect(() => sumMinor([0.1, 0.2])).toThrow();
    expect(isCurrency('ILS')).toBe(true);
    expect(isCurrency('JPY')).toBe(false);
  });
});
