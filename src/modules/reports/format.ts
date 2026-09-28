import { CURRENCIES, type Currency, isCurrency } from '../../core/money';

/**
 * Minor units to a plain decimal string, no thousands grouping, for a report cell (CSV, XLSX).
 * Integer math only (CLAUDE.md rule: money is never a float), unlike `core/money.ts`'s
 * `formatMinor`, which groups digits for display and is not meant for a parseable export cell.
 */
export function decimalMinor(amountMinor: number, currency: string = 'ILS'): string {
  const c: Currency = isCurrency(currency) ? currency : 'ILS';
  const digits = CURRENCIES[c].minorUnits;
  const negative = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  const scale = 10 ** digits;
  const whole = Math.floor(abs / scale);
  const fraction = (abs % scale).toString().padStart(digits, '0');
  return `${negative ? '-' : ''}${whole}${digits > 0 ? `.${fraction}` : ''}`;
}

/** Same as `decimalMinor`, as a JS number for an XLSX numeric cell. Display only, never stored back. */
export function numberMinor(amountMinor: number, currency: string = 'ILS'): number {
  return Number(decimalMinor(amountMinor, currency));
}
