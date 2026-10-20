import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { BackLink } from '../../components/BackLink';
import { usePreferences } from '../../app/preferences';
import { type MessageKey, useT } from '../../i18n';
import { categoryText } from '../financy/categories';
import { type ActivityFilter, type BankAccount, type BankTransaction, type MatchStatus, financyApi, formatMinor } from '../financy/api';

/**
 * R40: Expenses > Bank activity. What Financy pulled, with filters. Money out with no expense can
 * be added as an expense waiting for its receipt, or set aside as not a business expense. Money
 * in with a suggested document opens Record payment there, filled in. Nothing is recorded here.
 * The accountant reads only.
 */

const STATUS_KEYS: Record<MatchStatus, MessageKey> = {
  unmatched: 'expenses.bank.status.unmatched',
  matched: 'expenses.bank.status.matched',
  ignored: 'expenses.bank.status.ignored',
  added: 'expenses.bank.status.added',
};

const STATUS_CLASS: Record<MatchStatus, string> = {
  unmatched: 'bg-band text-brand',
  matched: 'bg-success/15 text-success',
  ignored: 'bg-canvas text-muted border border-line',
  added: 'bg-surface text-ink border border-line',
};

export function BankActivityPage() {
  const t = useT();
  const { locale } = usePreferences();
  const [filter, setFilter] = useState<ActivityFilter>({ month: new Date().toISOString().slice(0, 7) });
  const [rows, setRows] = useState<BankTransaction[] | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [notConnected, setNotConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const body = await financyApi.transactions(filter);
      setRows(body.transactions);
      setAccounts(body.accounts);
      setCanEdit(body.canEdit);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'financy_not_connected') setNotConnected(true);
      else setError(err instanceof Error ? err.message : t('expenses.bank.loadError'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (row: BankTransaction, action: () => Promise<{ transaction: BankTransaction }>) => {
    setBusyId(row.id);
    setRowErrors(({ [row.id]: _, ...rest }) => rest);
    try {
      const res = await action();
      setRows((list) => (list ?? []).map((r) => (r.id === row.id ? res.transaction : r)));
    } catch (err) {
      setRowErrors((all) => ({ ...all, [row.id]: err instanceof Error && err.message ? err.message : t('expenses.bank.actionError') }));
    } finally {
      setBusyId(null);
    }
  };

  const set = (patch: Partial<ActivityFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const select = 'rounded-md border border-line bg-surface px-2 py-1.5 text-sm';

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-5xl">
      <BackLink to="/expenses" />
      <h1 id="page-title" className="font-heading text-3xl text-ink">
        {t('expenses.bank.title')}
      </h1>

      {notConnected ? (
        <p className="mt-6 text-sm text-muted">
          {t('expenses.bank.notConnected')}{' '}
          <Link to="/settings?tab=expenses" className="text-brand hover:underline">
            {t('expenses.bank.openSettings')}
          </Link>
        </p>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-end gap-3" role="group" aria-label={t('expenses.bank.filters')}>
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t('expenses.bank.month')}
              <input type="month" className={`ltr-nums ${select}`} value={filter.month ?? ''} onChange={(e) => set({ month: e.target.value || undefined })} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t('expenses.bank.account')}
              <select className={select} value={filter.account ?? ''} onChange={(e) => set({ account: e.target.value || undefined })}>
                <option value="">{t('expenses.bank.all')}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {`${a.name ?? a.type}${a.last4 ? ` ··${a.last4}` : ''}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t('expenses.bank.direction')}
              <select className={select} value={filter.direction ?? ''} onChange={(e) => set({ direction: (e.target.value || undefined) as ActivityFilter['direction'] })}>
                <option value="">{t('expenses.bank.all')}</option>
                <option value="out">{t('expenses.bank.out')}</option>
                <option value="in">{t('expenses.bank.in')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t('expenses.bank.statusLabel')}
              <select className={select} value={filter.status ?? ''} onChange={(e) => set({ status: (e.target.value || undefined) as MatchStatus | undefined })}>
                <option value="">{t('expenses.bank.all')}</option>
                {(Object.keys(STATUS_KEYS) as MatchStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {t(STATUS_KEYS[s])}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && <p className="mt-4 text-sm text-danger">{error}</p>}

          <div className="mt-4 overflow-x-auto rounded-card border border-line bg-surface shadow-card">
            {rows === null ? (
              <p className="p-6 text-sm text-muted">{t('expenses.loading')}</p>
            ) : rows.length === 0 ? (
              <p className="p-10 text-center text-sm text-muted">{t('expenses.bank.empty')}</p>
            ) : (
              <table className="w-full text-start text-sm">
                <thead className="bg-band text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2">{t('expenses.bank.colDate')}</th>
                    <th className="px-3 py-2">{t('expenses.bank.colDetails')}</th>
                    <th className="px-3 py-2">{t('expenses.bank.colAmount')}</th>
                    <th className="px-3 py-2">{t('expenses.bank.colStatus')}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} data-testid={`bank-row-${r.id}`} className="border-t border-line align-top">
                      <td className="ltr-nums px-3 py-2">{r.date}</td>
                      <td className="px-3 py-2">
                        <span className="block text-ink" dir="auto">
                          {r.merchant ?? r.description ?? t('expenses.common.dash')}
                        </span>
                        {r.merchant && r.description && (
                          <span className="block text-xs text-muted" dir="auto">
                            {r.description}
                          </span>
                        )}
                        <span className="block text-xs text-muted" dir="auto">
                          {[r.accountName ? `${r.accountName}${r.accountLast4 ? ` ··${r.accountLast4}` : ''}` : null, categoryText(r.categoryMain, r.categorySub, locale), r.installment ? t('expenses.bank.installment', { number: String(r.installment.number), total: String(r.installment.total) }) : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </td>
                      <td className={`ltr-nums px-3 py-2 ${r.amountMinor < 0 ? 'text-ink' : 'text-success'}`}>
                        {formatMinor(r.amountMinor, r.currency)}
                        {r.originalCurrency && r.originalCurrency !== r.currency && r.originalAmountMinor !== null && (
                          <span className="block text-xs text-muted">{formatMinor(r.originalAmountMinor, r.originalCurrency)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[r.matchStatus]}`}>{t(STATUS_KEYS[r.matchStatus])}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {r.expenseId !== null && (
                            <Link to={`/expenses/${r.expenseId}`} className="text-sm text-brand hover:underline">
                              {t('expenses.bank.openExpense')}
                            </Link>
                          )}
                          {canEdit && r.matchStatus === 'unmatched' && r.amountMinor < 0 && (
                            <>
                              <button
                                type="button"
                                disabled={busyId === r.id}
                                onClick={() => void act(r, () => financyApi.addExpense(r.id))}
                                className="rounded-full border border-brand px-3 py-1 text-xs font-semibold text-brand hover:bg-band disabled:opacity-50"
                              >
                                {t('expenses.bank.addExpense')}
                              </button>
                              <button
                                type="button"
                                disabled={busyId === r.id}
                                onClick={() => void act(r, () => financyApi.ignore(r.id))}
                                className="rounded-full border border-line px-3 py-1 text-xs text-ink hover:bg-canvas disabled:opacity-50"
                              >
                                {t('expenses.bank.ignore')}
                              </button>
                            </>
                          )}
                          {canEdit && r.matchStatus === 'unmatched' && r.amountMinor > 0 && r.suggestion && (
                            <Link
                              to={`/income/documents/${r.suggestion.documentId}?payAmount=${r.amountMinor}&payOn=${r.date}`}
                              className="rounded-full border border-brand px-3 py-1 text-xs font-semibold text-brand hover:bg-band"
                            >
                              {t('expenses.bank.recordPayment', { number: r.suggestion.displayNumber ?? String(r.suggestion.documentId) })}
                            </Link>
                          )}
                        </div>
                        {rowErrors[r.id] && (
                          <p role="alert" className="mt-1 text-xs text-danger">
                            {rowErrors[r.id]}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  );
}
