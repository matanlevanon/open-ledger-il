/**
 * Display-only money formatting for the web app. Amounts arrive from the API already as
 * integers in minor units, never floats (see src/core/money.ts on the Worker side). This
 * module stays self-contained so the web bundle never depends on Worker-only code.
 */

export const CURRENCY_SYMBOLS: Record<string, string> = {
  ILS: '₪',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? `${currency} `;
}

/** Formats minor units as a plain major-unit string with grouping: 123456 -> "1,234.56". */
export function formatMinor(amountMinor: number, minorUnits = 2): string {
  const negative = amountMinor < 0;
  const abs = Math.abs(Math.trunc(amountMinor));
  const scale = 10 ** minorUnits;
  const whole = Math.floor(abs / scale)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (abs % scale).toString().padStart(minorUnits, '0');
  return `${negative ? '-' : ''}${whole}${minorUnits > 0 ? `.${fraction}` : ''}`;
}

/** "$1,234.56", "₪-40.00", or "XYZ 5.00" for a currency without a known symbol. */
export function formatMoney(amountMinor: number, currency: string): string {
  return `${currencySymbol(currency)}${formatMinor(amountMinor)}`;
}
