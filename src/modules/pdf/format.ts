import { CURRENCIES, type Currency, formatMinor } from '../../core/money';

/** DD/MM/YYYY, the same numeric form in both languages. Avoids Hebrew month-name mistakes. */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

/** 1000 -> "1", 1500 -> "1.5", 333 -> "0.333". */
export function formatQuantity(quantityMilli: number): string {
  if (quantityMilli % 1000 === 0) return String(quantityMilli / 1000);
  return (quantityMilli / 1000).toString();
}

export function formatAmount(amountMinor: number, currency: Currency): string {
  return formatMinor(amountMinor, currency);
}

export function currencySymbol(currency: Currency): string {
  return CURRENCIES[currency].symbol;
}

export function formatVatRate(rateBp: number): string {
  return `${(rateBp / 100).toString()}%`;
}

/** "1234567" -> "123-456-7" style grouping is not required; the ITA prints the raw 9 digits. */
export function formatAllocationNumber(value: string): string {
  return value.trim();
}
