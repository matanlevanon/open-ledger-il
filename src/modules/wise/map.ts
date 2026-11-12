import type { FinancyAccount, FinancyTransaction } from '../financy/client';
import { OWN_MOVE_CATEGORY } from '../financy/flows';
import type { WiseBalance, WiseStatementRow } from './client';

/**
 * R49: Wise balances and statement rows in the shape the bank tables already store
 * (`storeBankData` in ../financy/sync.ts). Every id starts with "wise:", so a Wise row never
 * collides with a Financy one and the bank screens tell the source by the id.
 */

export const WISE_PROVIDER = 'wise';

export const wiseAccountId = (balanceId: number) => `wise:${balanceId}`;

const num = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const clean = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

export function wiseAccount(balance: WiseBalance): FinancyAccount {
  const currency = (balance.currency ?? '').toUpperCase();
  return {
    id: wiseAccountId(balance.id!),
    providerId: WISE_PROVIDER,
    accountType: 'CHECKING',
    accountName: clean(balance.name) ?? `Wise ${currency}`,
    currency,
    balances: [{ balanceType: 'interimAvailable', balanceAmount: { amount: num(balance.amount?.value) ?? 0, currency }, creditLimitIncluded: false }],
  };
}

/**
 * The rows of one balance. A row with no reference number or amount is left out. Wise gives one
 * reference per transaction, and a conversion shows on both balances under the same reference, so
 * the id carries the balance too. Two rows of one reference on one balance get a counter.
 *
 * Money in that cost a fee (a wire) arrives net. The amount the payer sent goes into the original
 * amount, so the deposit still matches a payment request for the full sum.
 */
export function wiseTransactions(balance: WiseBalance, rows: WiseStatementRow[]): FinancyTransaction[] {
  const accountId = wiseAccountId(balance.id!);
  const currency = (balance.currency ?? '').toUpperCase();
  const seen = new Map<string, number>();
  const out: FinancyTransaction[] = [];
  for (const row of rows) {
    const reference = clean(row.referenceNumber);
    const value = num(row.amount?.value);
    const date = row.date && /^\d{4}-\d{2}-\d{2}/.test(row.date) ? row.date.slice(0, 10) : null;
    if (!reference || value === null || value === 0 || !date) continue;
    const credit = (row.type ?? '').toUpperCase() === 'CREDIT' || ((row.type ?? '') === '' && value > 0);
    const signed = credit ? Math.abs(value) : -Math.abs(value);
    const fees = Math.abs(num(row.totalFees?.value) ?? 0);
    const count = (seen.get(reference) ?? 0) + 1;
    seen.set(reference, count);
    const details = row.details ?? {};
    const kind = (details.type ?? '').toUpperCase();
    const conversion = kind === 'CONVERSION';
    const who = credit ? clean(details.senderName) : (clean(details.recipient?.name) ?? clean(details.merchant?.name));
    const reason = clean(details.paymentReference);
    const description = clean(details.description) ?? ([who, reason ? `Ref ${reason}` : null].filter(Boolean).join(' · ') || null);
    out.push({
      id: `${accountId}:${reference}${count > 1 ? `#${count}` : ''}`,
      accountId,
      providerId: WISE_PROVIDER,
      amount: {
        chargedAmount: { amount: signed.toFixed(2), currency },
        originalAmount: credit && fees > 0 ? { amount: (Math.abs(value) + fees).toFixed(2), currency } : undefined,
      },
      description: { description, additionalInfo: reason },
      merchantName: who,
      category: { main: conversion ? OWN_MOVE_CATEGORY : (clean(details.category) ?? (kind || null)), sub: null },
      date: { transactionDate: null, bookingDate: date, valueDate: date },
    });
  }
  return out;
}
