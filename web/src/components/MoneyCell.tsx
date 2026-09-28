import { formatMoney } from '../lib/money';

interface MoneyCellProps {
  amountMinor: number;
  currency: string;
  /** ILS figure to show under the line, per docs/currency-and-fx.md. Omit for a document that has none yet. */
  ilsMinor?: number | null;
  className?: string;
}

/** Foreign amount first, home-currency figure under the line when present. */
export function MoneyCell({ amountMinor, currency, ilsMinor, className }: MoneyCellProps) {
  return (
    <div data-testid="money-cell" className={`text-end ${className ?? ''}`}>
      <div className="tabular-nums ltr-nums text-ink">{formatMoney(amountMinor, currency)}</div>
      {ilsMinor != null && currency !== 'ILS' && (
        <div className="tabular-nums ltr-nums text-xs text-muted">{formatMoney(ilsMinor, 'ILS')}</div>
      )}
    </div>
  );
}
