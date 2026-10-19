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

/** A partner card under Settings > Expenses: Financy covers the bank and card side the Ledger does not see. */
export function FinancyCard() {
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
      <h2 className="font-heading text-lg text-ink">{t('settings.expenses.financyTitle')}</h2>
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
        <button type="button" onClick={hide} className="text-xs text-muted underline">
          {t('settings.expenses.financyHide')}
        </button>
      </div>
      <p className="text-xs text-muted">{t('settings.expenses.financyPartner')}</p>
    </section>
  );
}
