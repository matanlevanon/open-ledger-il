import { useState } from 'react';
import { useT } from '../../i18n';
import { FINANCY_URL } from '../../lib/partners';

const HIDE_KEY = 'open-ledger-il-hide:financy';

function hidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * A partner card under Settings > Expenses: Financy covers the bank and card side the Ledger does
 * not see. R40: a Connected chip once the connection is set, else a Connect button that scrolls to
 * the connection panel.
 */
export function FinancyCard({ connected = false, onConnect }: { connected?: boolean; onConnect?: () => void } = {}) {
  const t = useT();
  const [gone, setGone] = useState(hidden);
  if (gone) return null;
  const hide = () => {
    try {
      localStorage.setItem(HIDE_KEY, '1');
    } catch {
      /* the card hides for this visit only */
    }
    setGone(true);
  };
  return (
    <section data-testid="financy-card" className="flex flex-col gap-2 rounded-md border border-line px-4 py-3">
      <h2 className="flex flex-wrap items-center gap-2 font-heading text-lg text-ink">
        {t('settings.expenses.financyTitle')}
        {connected && (
          <span data-testid="financy-connected" className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">
            {t('settings.financy.connectedChip')}
          </span>
        )}
      </h2>
      <p className="text-sm text-ink" dir="auto">
        {t('settings.expenses.financyBody')}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={FINANCY_URL}
          target="_blank"
          rel="sponsored noopener"
          className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-surface"
        >
          {t('settings.expenses.financyOpen')}
        </a>
        {!connected && onConnect && (
          <button type="button" onClick={onConnect} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90">
            {t('settings.financy.connectShort')}
          </button>
        )}
        <button type="button" onClick={hide} className="text-xs text-muted underline">
          {t('settings.expenses.financyHide')}
        </button>
      </div>
      <p className="text-xs text-muted">{t('settings.expenses.financyPartner')}</p>
    </section>
  );
}
