import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { usePreferences } from '../../app/preferences';
import { BackLink } from '../../components/BackLink';
import { type MessageKey, useT } from '../../i18n';
import { type ActivityFilter, type BankAccount, type BankTransaction, type Flow, type MatchStatus, financyApi, formatMinor } from '../financy/api';
import { RowActions, StatusCell } from '../financy/actions';
import { categoryText } from '../financy/categories';

/**
 * R40: Expenses > Bank activity, the full list of what Financy pulled. R42: the same status column
 * and actions as the Financy Dashboard (financy/actions.tsx), a filter for rows not counted, and
 * filters read from the address so the dashboard's links open it filtered. Nothing records a
 * payment here. The accountant reads only.
 */

const STATUS_KEYS: Record<MatchStatus, MessageKey> = {
  unmatched: 'expenses.bank.status.unmatched',
  matched: 'expenses.bank.status.matched',
  ignored: 'expenses.bank.status.ignored',
  added: 'expenses.bank.status.added',
};

const FLOW_KEYS: Record<Flow, MessageKey> = {
  normal: 'expenses.bank.flow.normal',
  own_transfer: 'expenses.bank.flow.ownTransfer',
  card_payment: 'expenses.bank.flow.cardPayment',
};

const MATCH_STATUSES = Object.keys(STATUS_KEYS) as MatchStatus[];
const FLOWS = Object.keys(FLOW_KEYS) as Flow[];

/** The filter the address names. With none named, the current month. */
function filterFrom(params: URLSearchParams): ActivityFilter {
  const pick = <T extends string>(value: string | null, allowed: readonly T[]) => (value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined);
  const named = ['month', 'account', 'direction', 'status', 'flow'].some((k) => params.has(k));
  if (!named) return { month: new Date().toISOString().slice(0, 7) };
  return {
    month: /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month')! : undefined,
    account: params.get('account') || undefined,
    direction: pick(params.get('direction'), ['in', 'out'] as const),
    status: pick(params.get('status'), MATCH_STATUSES),
    flow: pick(params.get('flow'), FLOWS),
  };
}

export function BankActivityPage() {
  const t = useT();
  const { locale } = usePreferences();
  const [params] = useSearchParams();
  const [filter, setFilter] = useState<ActivityFilter>(() => filterFrom(params));
  const [rows, setRows] = useState<BankTransaction[] | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [notConnected, setNotConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const replace = (next: BankTransaction) => {
    setRowErrors(({ [next.id]: _, ...rest }) => rest);
    setRows((list) => (list ?? []).map((r) => (r.id === next.id ? next : r)));
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
                {MATCH_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(STATUS_KEYS[s])}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              {t('expenses.bank.flowLabel')}
              <select className={select} value={filter.flow ?? ''} onChange={(e) => set({ flow: (e.target.value || undefined) as Flow | undefined })}>
                <option value="">{t('expenses.bank.all')}</option>
                {FLOWS.map((f) => (
                  <option key={f} value={f}>
                    {t(FLOW_KEYS[f])}
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
                          {[
                            r.accountName ? `${r.accountName}${r.accountLast4 ? ` ··${r.accountLast4}` : ''}` : null,
                            categoryText(r.categoryMain, r.categorySub, locale),
                            r.installment ? t('expenses.bank.installment', { number: String(r.installment.number), total: String(r.installment.total) }) : null,
                          ]
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
                        <StatusCell tx={r} />
                      </td>
                      <td className="px-3 py-2">
                        {canEdit ? (
                          <RowActions tx={r} onChange={replace} onError={(message) => setRowErrors((all) => ({ ...all, [r.id]: message }))} />
                        ) : (
                          r.expenseId !== null && (
                            <Link to={`/expenses/${r.expenseId}`} className="text-sm text-brand hover:underline">
                              {t('expenses.bank.openExpense')}
                            </Link>
                          )
                        )}
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
