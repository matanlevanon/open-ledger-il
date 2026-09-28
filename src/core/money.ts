/**
 * Money rules for Open Ledger IL.
 *
 * - Amounts are integers in minor units (agorot, cents). Never floats.
 * - Exchange rates are decimal strings with up to 6 decimals, for example "3.712000".
 *   Internally a rate is a bigint of micro-units (rate × 1,000,000).
 * - Conversion multiplies in bigint and rounds once, at the end.
 *
 * Rounding: every currency result rounds half away from zero, the common commercial rule.
 * An exact half agora goes up in size: 0.5 becomes 1 and -0.5 becomes -1. Every other
 * fraction rounds to the nearest agora. This is the only rounding rule in the ledger.
 */

export const CURRENCIES = {
  ILS: { code: 'ILS', minorUnits: 2, symbol: '₪', nameEn: 'Israeli new shekel' },
  USD: { code: 'USD', minorUnits: 2, symbol: '$', nameEn: 'US dollar' },
  EUR: { code: 'EUR', minorUnits: 2, symbol: '€', nameEn: 'Euro' },
  GBP: { code: 'GBP', minorUnits: 2, symbol: '£', nameEn: 'Pound sterling' },
} as const;

export type Currency = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as Currency[];
export const HOME_CURRENCY: Currency = 'ILS';

export const RATE_DECIMALS = 6;
const RATE_SCALE = 1_000_000n;
const RATE_PATTERN = /^(\d{1,6})(?:\.(\d{1,6}))?$/;

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && Object.hasOwn(CURRENCIES, value);
}

export function assertCurrency(value: unknown): Currency {
  if (!isCurrency(value)) throw new RangeError(`Unsupported currency: ${String(value)}`);
  return value;
}

/** Throws unless the value is a safe integer. Use on every amount entering the core. */
export function assertMinor(value: number, label = 'amount'): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be an integer in minor units, got ${value}`);
  }
  return value;
}

/** Parses a rate string ("3.712", "3.712000") into micro-units. Rejects zero, negatives and floats. */
export function parseRate(rate: string): bigint {
  if (typeof rate !== 'string') throw new TypeError('Rate must be a decimal string');
  const match = RATE_PATTERN.exec(rate.trim());
  if (!match) throw new RangeError(`Invalid rate "${rate}". Use up to 6 decimals, for example 3.712000`);
  const whole = BigInt(match[1]!);
  const fraction = BigInt((match[2] ?? '').padEnd(RATE_DECIMALS, '0'));
  const micro = whole * RATE_SCALE + fraction;
  if (micro === 0n) throw new RangeError('Rate must be above zero');
  return micro;
}

/** Formats micro-units back to the canonical 6-decimal string. */
export function formatRate(micro: bigint): string {
  if (micro <= 0n) throw new RangeError('Rate must be above zero');
  const whole = micro / RATE_SCALE;
  const fraction = (micro % RATE_SCALE).toString().padStart(RATE_DECIMALS, '0');
  return `${whole}.${fraction}`;
}

/** Canonical 6-decimal form of a rate string. "3.7" becomes "3.700000". */
export function normalizeRate(rate: string): string {
  return formatRate(parseRate(rate));
}

/** Integer division of a signed numerator by a positive denominator, rounding half away from zero. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('Denominator must be positive');
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  let quotient = abs / denominator;
  if ((abs % denominator) * 2n >= denominator) quotient += 1n;
  return negative ? -quotient : quotient;
}

function toSafeNumber(value: bigint, label: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError(`${label} overflows a safe integer`);
  return n;
}

/**
 * Converts a foreign amount in minor units to ILS minor units at the given rate.
 * Both currencies here carry 2 minor units, so minor × rate gives agorot directly.
 * Negative amounts (credits) round symmetrically.
 */
export function convert(amountMinor: number, rate: string): number {
  assertMinor(amountMinor);
  const micro = parseRate(rate);
  return toSafeNumber(divRound(BigInt(amountMinor) * micro, RATE_SCALE), 'Converted amount');
}

/** Applies a rate held in basis points (1800 = 18%) to an amount. Used for VAT. */
export function percentOf(amountMinor: number, basisPoints: number): number {
  assertMinor(amountMinor);
  assertMinor(basisPoints, 'basisPoints');
  if (basisPoints < 0) throw new RangeError('basisPoints must not be negative');
  return toSafeNumber(divRound(BigInt(amountMinor) * BigInt(basisPoints), 10_000n), 'Percentage');
}

/** Sums minor amounts, refusing anything that is not a safe integer or that overflows. */
export function sumMinor(amounts: readonly number[]): number {
  let total = 0n;
  for (const a of amounts) total += BigInt(assertMinor(a));
  return toSafeNumber(total, 'Sum');
}

/** Parses a major-unit string ("1,234.5") into minor units without floats. */
export function parseMajor(value: string, currency: Currency): number {
  const digits = CURRENCIES[currency].minorUnits;
  const cleaned = value.trim().replace(/,/g, '');
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) throw new RangeError(`Invalid amount "${value}"`);
  const fraction = match[3] ?? '';
  if (fraction.length > digits) throw new RangeError(`Amount "${value}" has more than ${digits} decimals`);
  const minor = BigInt(match[2]!) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
  return toSafeNumber(match[1] ? -minor : minor, 'Amount');
}

/** Formats minor units as a plain major-unit string with grouping: 123456 -> "1,234.56". */
export function formatMinor(amountMinor: number, currency: Currency): string {
  assertMinor(amountMinor);
  const digits = CURRENCIES[currency].minorUnits;
  const negative = amountMinor < 0;
  const abs = BigInt(Math.abs(amountMinor));
  const scale = 10n ** BigInt(digits);
  const whole = (abs / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (abs % scale).toString().padStart(digits, '0');
  return `${negative ? '-' : ''}${whole}${digits > 0 ? `.${fraction}` : ''}`;
}
