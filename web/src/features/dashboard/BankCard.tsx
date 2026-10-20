import { Link } from 'react-router-dom';
import { useT } from '../../i18n';
import { type BankSummary, formatMinor, shortTime } from '../financy/api';

/**
 * R40: the Bank card, when Financy is connected. Each checking account with what is available,
 * each card with what it charged so far and its due date, the last sync, and Bank activity.
 */
export function BankCard({ bank }: { bank: BankSummary }) {
  const t = useT();
  const checking = bank.accounts.filter((a) => a.type === 'CHECKING');
  const cards = bank.accounts.filter((a) => a.type === 'CARD');
  const amount = (minor: number | null, currency: string | null) => (minor === null ? t('dashboard.bank.unknown') : formatMinor(minor, currency ?? 'ILS'));
  const name = (a: BankSummary['accounts'][number]) => `${a.name ?? t('dashboard.bank.account')}${a.last4 ? ` ··${a.last4}` : ''}`;

  return (
    <section data-testid="bank-card" className="mt-4 rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-lg text-ink">{t('dashboard.bank.title')}</h2>
        <Link to="/expenses/bank" className="text-sm text-brand hover:underline">
          {t('dashboard.bank.activity')}
        </Link>
      </div>
      {bank.status === 'error' && <p className="mt-1 text-sm text-danger">{t('dashboard.bank.syncError')}</p>}
      {bank.accounts.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t('dashboard.bank.empty')}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {checking.flatMap((a) =>
            // One line per currency: a single account can hold shekels, dollars and euros.
            (a.balances?.length ? a.balances : [{ currency: a.currency ?? 'ILS', balanceMinor: a.balanceMinor, balanceType: a.balanceType ?? '' }]).map((b) => (
              <li key={`${a.id}:${b.currency}`} className="flex flex-wrap justify-between gap-2">
                <span dir="auto">{name(a)}</span>
                <span className="ltr-nums font-semibold text-ink">{amount(b.balanceMinor, b.currency)}</span>
              </li>
            )),
          )}
          {cards.map((a) => (
            <li key={a.id} className="flex flex-wrap justify-between gap-2">
              <span dir="auto">
                {name(a)}
                {a.cardDueDate && (
                  <span className="ms-2 text-xs text-muted">
                    {/^\d{1,2}$/.test(a.cardDueDate) ? t('dashboard.bank.dueDay', { day: a.cardDueDate }) : t('dashboard.bank.due', { date: a.cardDueDate })}
                  </span>
                )}
              </span>
              <span className="ltr-nums text-ink">{t('dashboard.bank.charged', { amount: amount(a.balanceMinor === null ? null : Math.abs(a.balanceMinor), a.currency) })}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="ltr-nums mt-2 text-xs text-muted">{bank.lastSyncAt ? t('dashboard.bank.lastSync', { time: shortTime(bank.lastSyncAt) }) : t('dashboard.bank.notSynced')}</p>
    </section>
  );
}
