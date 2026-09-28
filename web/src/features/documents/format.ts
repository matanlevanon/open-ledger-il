/** Money and quantity helpers for the web app. Integers only, no floats (runs/_common.md). */
import type { MessageKey } from '../../i18n';
import type { DocType } from './api';

const SYMBOLS: Record<string, string> = { ILS: '₪', USD: '$', EUR: '€', GBP: '£' };

/** "$ USD", "₪ ILS"; just the code for a currency without a known symbol. */
export function currencyTag(currency: string): string {
  const symbol = SYMBOLS[currency];
  return symbol ? `${symbol} ${currency}` : currency;
}

/**
 * Document types offered by "Create new" (sidebar) and "New document" (client page): enabled by
 * the current legal mode, minus 332 (its own separate advance-approval flow) and credit invoices
 * (created from the invoice they credit, never picked directly). Shared so both menus follow the
 * legal mode from the same list (R18 task 7, R19 task 7), in `document_types.sort_order`.
 */
const EXCLUDED_NEW_DOCUMENT_KINDS = new Set(['credit_invoice']);
export function offeredDocumentTypes(types: DocType[]): DocType[] {
  return types.filter((ty) => ty.enabled === 1 && ty.code !== '332' && !EXCLUDED_NEW_DOCUMENT_KINDS.has(ty.kind));
}

/**
 * Document types with their own dedicated "new" route (R18 task 7); everything else uses
 * /income/documents/new?type=<code>. 300 is the one proforma type now (merged with PF's
 * behaviour); PF is disabled for new documents so it never reaches this map in practice.
 */
const DEDICATED_NEW_PATH: Record<string, string> = {
  QT: '/income/quotes/new',
  PR: '/income/payment-requests/new',
  PF: '/income/proformas/new',
  '300': '/income/proformas/new',
};

/** The "Create new" / "New document" link for a type, optionally preselecting a client. */
export function newDocumentPath(code: string, clientId?: number): string {
  const base = DEDICATED_NEW_PATH[code] ?? `/income/documents/new?type=${code}`;
  return clientId === undefined ? base : `${base}${base.includes('?') ? '&' : '?'}client=${clientId}`;
}

export const CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP'];

/** 123456 -> "1,234.56". */
export function formatMinor(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (abs % 100).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** 123456, "USD" -> "$1,234.56". */
export function money(minor: number, currency: string): string {
  const text = formatMinor(minor);
  const symbol = SYMBOLS[currency];
  if (!symbol) return `${text} ${currency}`;
  return text.startsWith('-') ? `-${symbol}${text.slice(1)}` : `${symbol}${text}`;
}

/** Parses "1,234.5" into minor units. Returns null when the text is not an amount. */
export function parseMinor(text: string): number | null {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim().replace(/,/g, ''));
  if (!match) return null;
  const value = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(value)) return null;
  return match[1] ? -value : value;
}

/** Parses "1.5" into thousandths (1500). */
export function parseMilli(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (!match) return null;
  const value = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0') || '0');
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function formatMilli(milli: number): string {
  const whole = Math.trunc(milli / 1000);
  const fraction = (milli % 1000).toString().padStart(3, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** Same rounding as the Worker: quantity x price, half away from zero, minus discount. */
export function lineTotal(quantityMilli: number, unitPriceMinor: number, discountMinor = 0): number {
  const product = BigInt(quantityMilli) * BigInt(unitPriceMinor);
  const negative = product < 0n;
  const abs = negative ? -product : product;
  let q = abs / 1000n;
  if ((abs % 1000n) * 2n >= 1000n) q += 1n;
  return Number(negative ? -q : q) - discountMinor;
}

export function totalsText(totals: Record<string, number>): string {
  const parts = Object.entries(totals)
    .filter(([, v]) => v !== 0)
    .map(([c, v]) => money(v, c));
  return parts.length ? parts.join(' · ') : '0.00';
}

/** Message-catalog keys, not display text (R16 task 16): render with `t(STATE_LABEL_KEYS[state])`. */
export const STATE_LABEL_KEYS: Record<string, MessageKey> = {
  draft: 'documents.state.draft',
  open: 'documents.state.open',
  partial: 'documents.state.partial',
  paid: 'documents.state.paid',
  converted: 'documents.state.converted',
  final: 'documents.state.final',
  partially_credited: 'documents.state.partiallyCredited',
  credited: 'documents.state.credited',
  cancelled: 'documents.state.cancelled',
  awaiting_allocation: 'documents.state.awaitingAllocation',
};

/** Message-catalog keys, not display text (R16 task 16): render with `t(METHOD_LABEL_KEYS[method])`. */
export const METHOD_LABEL_KEYS: Record<string, MessageKey> = {
  bank_transfer: 'documents.method.bankTransfer',
  card: 'documents.method.card',
  cheque: 'documents.method.cheque',
  cash: 'documents.method.cash',
  other: 'documents.method.other',
};

export function todayLocal(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
}

/**
 * R19: a client may have only one of name_en, name_he. English UI prefers name_en, Hebrew UI
 * prefers name_he, each falling back to the other. Never returns an empty string unless both
 * names are empty.
 */
export function clientName(c: { name_en: string | null; name_he: string | null }, locale: 'en' | 'he'): string {
  const en = (c.name_en ?? '').trim();
  const he = (c.name_he ?? '').trim();
  return locale === 'he' ? he || en : en || he;
}
