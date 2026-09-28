import type { MessageKey } from '../../i18n';

/**
 * Minor units to a plain display string, for example 23600 ILS -> "ILS 236.00". Integer
 * arithmetic only (src/core/money.ts rule: never floats for money), every supported
 * currency here uses 2 minor units.
 */
export function formatMinor(amountMinor: number, currency: string): string {
  const negative = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  const whole = Math.trunc(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  return `${currency} ${negative ? '-' : ''}${whole}.${cents}`;
}

/** Message-catalog keys, not display text (R16 task 16): render with `t(STATUS_LABEL_KEYS[status] ?? ...)`. */
export const STATUS_LABEL_KEYS: Record<string, MessageKey> = {
  new: 'expenses.status.new',
  filed: 'expenses.status.filed',
  not_expense: 'expenses.status.notExpense',
  duplicate: 'expenses.status.duplicate',
  returned: 'expenses.status.returned',
};
