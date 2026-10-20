import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DemoReadOnlyNote, useDemoLocked } from '../../app/demo';
import { usePreferences } from '../../app/preferences';
import { useT } from '../../i18n';
import { formatMoney } from '../../lib/money';
import { AXIS, GRID, MoneyTooltip, OTHER_COLOR, SERIES, compactIls, useMonthLabel } from '../dashboard/charts';
import { type BankTransaction, type CategoryRow, type FinancyDashboardData, financyApi, shortTime } from './api';
import { RowActions, StatusCell } from './actions';
import { categoryLabel } from './categories';

/**
 * R42: Dashboard > Financy Dashboard. Built like Financy's own dashboard:
 * four tiles, cash flow, categories, the accounts, the recent
 * rows with their status and actions, and what waits to be matched. Only the business accounts
 * picked in Settings > Expenses count. Every chart sits over its numbers (the R21 rule).
 */

const INCOME = 'rgb(var(--color-success))';
const EXPENSE = 'rgb(var(--color-danger))';

/** Whole shekels, "₪34,183", for tiles and totals. Tables keep agorot. */
export function wholeIls(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  return `${sign}₪${Math.round(Math.abs(minor) / 100).toLocaleString('en-US')}`;
}

/** A provider badge: two or three letters in the provider's color. No external images. */
const PROVIDERS: Record<string, { text: string; color: string }> = {
  hapoalim: { text: 'פו', color: '#d7141a' },
  leumi: { text: 'לא', color: '#0071bc' },
  discount: { text: 'דס', color: '#1d8348' },
  mizrahi: { text: 'מז', color: '#f37021' },
  'one-zero': { text: '01', color: '#111111' },
  onezero: { text: '01', color: '#111111' },
  isracard: { text: 'IC', color: '#1c4e9c' },
  max: { text: 'MAX', color: '#14193d' },
  cal: { text: 'CAL', color: '#0060a9' },
  amex: { text: 'AX', color: '#2e77bb' },
  diners: { text: 'DC', color: '#004a97' },
};

export function ProviderBadge({ provider }: { provider: string | null }) {
  const key = (provider ?? '').toLowerCase();
  const known = PROVIDERS[key] ?? Object.entries(PROVIDERS).find(([k]) => key.includes(k))?.[1];
  const text = known?.text ?? (key.slice(0, 2).toUpperCase() || '··');
  return (
    <span
      aria-hidden="true"
      data-testid="provider-badge"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-[11px] font-bold text-white"
      style={{ background: known?.color ?? 'rgb(var(--color-muted))' }}
    >
      {text}
    </span>
  );
}

function Panel({ title, aside, children, testid }: { title: ReactNode; aside?: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <section data-testid={testid} className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-heading text-lg text-ink">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Switch<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full border border-line bg-canvas p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-3 py-1 font-semibold ${o.value === value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The change against last month. Up is good for income and net, bad for expenses. */
function Change({ pct, goodWhenUp }: { pct: number | null; goodWhenUp: boolean }) {
  const t = useT();
  if (pct === null) return <p className="text-xs text-muted">{t('financy.dash.noCompare')}</p>;
  const up = pct > 0;
  const good = pct === 0 || up === goodWhenUp;
  return (
    <p className={`text-xs ${good ? 'text-success' : 'text-danger'}`}>
      <span aria-hidden="true">{pct === 0 ? '→' : up ? '↑' : '↓'}</span> <span className="ltr-nums font-semibold">{Math.abs(pct)}%</span>{' '}
      <span className="text-muted">{t('financy.dash.vsLastMonth')}</span>
    </p>
  );
}

function Tile({ title, children, testid }: { title: string; children: ReactNode; testid: string }) {
  return (
    <div data-testid={testid} className="flex flex-col gap-1 p-4">
      <p className="text-sm text-muted">{title}</p>
      {children}
    </div>
  );
}

export function FinancyDashboard() {
  const t = useT();
  const { locale } = usePreferences();
  const monthLabel = useMonthLabel();
  const [months, setMonths] = useState<3 | 6>(3);
  const [data, setData] = useState<FinancyDashboardData | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const locked = useDemoLocked();
  const [catMode, setCatMode] = useState<'expenses' | 'income'>('expenses');
  const [showIls, setShowIls] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(
    (m: 3 | 6) =>
      financyApi
        .dashboard(m)
        .then((r) => {
          setData(r.dashboard);
          setError(null);
        })
        .catch((err) => setError(err instanceof Error ? err.message : t('financy.dash.loadError'))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    void load(months);
  }, [load, months]);

  const sync = async () => {
    setSyncing(true);
    try {
      await financyApi.sync();
      await load(months);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('financy.dash.loadError'));
    } finally {
      setSyncing(false);
    }
  };

  const replaceRow = (next: BankTransaction) => {
    setRowError(null);
    // A change moves the tiles and the to-match counts too, so the numbers come again.
    setData((d) => (d ? { ...d, recent: d.recent.map((r) => (r.id === next.id ? next : r)) } : d));
    void load(months);
  };

  if (error && data === undefined) {
    return (
      <p role="alert" className="mt-6 text-sm text-danger">
        {error}
      </p>
    );
  }
  if (data === undefined) return <p className="mt-6 text-sm text-muted">{t('financy.loading')}</p>;
  if (data === null) {
    return (
      <p data-testid="financy-dash-empty" className="mt-6 text-sm text-muted">
        {t('financy.dash.notReady')}{' '}
        <Link to="/settings?tab=expenses" className="font-semibold text-accent-2 hover:underline">
          {t('financy.dash.openSettings')}
        </Link>
      </p>
    );
  }

  const d = data;
  const thisMonth = d.month.month;
  const cats = d.categories[catMode];
  const cashTotals = d.cashflow.reduce((s, m) => ({ income: s.income + m.income, expenses: s.expenses + m.expenses }), { income: 0, expenses: 0 });
  const liquidityShare = d.liquidity.cash + d.liquidity.cardsCurrent > 0 ? (d.liquidity.cash / (d.liquidity.cash + d.liquidity.cardsCurrent)) * 100 : 100;
  const catName = (c: CategoryRow) => (c.key === 'OTHER_REST' ? t('financy.dash.other') : c.key === '' ? t('financy.dash.noCategory') : (categoryLabel(c.key, locale) ?? c.label));
  const catColor = (c: CategoryRow, i: number) => (c.key === 'OTHER_REST' ? OTHER_COLOR : SERIES[i % SERIES.length]!);

  return (
    <div data-testid="financy-dashboard" className="mt-4 flex flex-col gap-4">
      {locked && <DemoReadOnlyNote text={t('financy.dash.demoNote')} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {t('financy.dash.scope', { count: String(d.accountCount) })}{' '}
          <Link to="/settings?tab=expenses" className="font-semibold text-accent-2 hover:underline">
            {t('financy.dash.change')}
          </Link>
        </p>
        <div className="flex items-center gap-3 text-sm">
          <span className="ltr-nums text-muted">{d.lastSyncAt ? t('financy.dash.lastSync', { time: shortTime(d.lastSyncAt) }) : t('financy.dash.notSynced')}</span>
          {!locked && (
            <button type="button" disabled={syncing} onClick={() => void sync()} className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-50">
              {syncing ? t('financy.dash.syncing') : t('financy.dash.syncNow')}
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {d.status === 'error' && <p className="text-sm text-danger">{t('financy.dash.syncError')}</p>}

      {/* The top strip. */}
      <section className="rounded-card border border-line bg-surface shadow-card">
        <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x lg:rtl:divide-x-reverse">
          <Tile testid="tile-liquidity" title={t('financy.dash.liquidity')}>
            <p className="ltr-nums font-heading text-3xl text-ink">{wholeIls(d.liquidity.net)}</p>
            <p className="text-xs text-muted">{t('financy.dash.loansNotCounted')}</p>
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
              <span style={{ width: `${liquidityShare}%`, background: SERIES[0] }} />
              <span style={{ width: `${100 - liquidityShare}%`, background: EXPENSE }} />
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-xs">
              <span>
                <span className="me-1 inline-block h-2 w-2 rounded-full" style={{ background: SERIES[0] }} />
                {t('financy.dash.cash')} <span className="ltr-nums font-semibold">{wholeIls(d.liquidity.cash)}</span>
              </span>
              <span>
                <span className="me-1 inline-block h-2 w-2 rounded-full" style={{ background: EXPENSE }} />
                {t('financy.dash.cardsCurrent')} <span className="ltr-nums font-semibold">{wholeIls(d.liquidity.cardsCurrent)}</span>
              </span>
            </div>
          </Tile>
          <Tile testid="tile-income" title={t('financy.dash.incomeMonth')}>
            <p className="ltr-nums font-heading text-3xl text-ink">{wholeIls(d.month.current.income)}</p>
            <Change pct={d.month.changePct.income} goodWhenUp />
          </Tile>
          <Tile testid="tile-expenses" title={t('financy.dash.expensesMonth')}>
            <p className="ltr-nums font-heading text-3xl text-ink">{wholeIls(d.month.current.expenses)}</p>
            <Change pct={d.month.changePct.expenses} goodWhenUp={false} />
          </Tile>
          <Tile testid="tile-net" title={t('financy.dash.netMonth')}>
            <p className={`ltr-nums font-heading text-3xl ${d.month.current.net < 0 ? 'text-danger' : 'text-success'}`}>{wholeIls(d.month.current.net)}</p>
            <Change pct={d.month.changePct.net} goodWhenUp />
          </Tile>
        </div>
        <p data-testid="not-counted" className="border-t border-line px-4 py-2 text-xs text-muted">
          {t('financy.dash.notCounted', { amount: wholeIls(d.excluded.sum) })}
          {d.unconverted.length > 0 && ` ${t('financy.dash.unconverted', { list: d.unconverted.join(', ') })}`}
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          {/* Cash flow. */}
          <Panel
            testid="cashflow"
            title={t('financy.dash.cashflow')}
            aside={<Switch label={t('financy.dash.cashflow')} value={months} onChange={setMonths} options={[{ value: 3, label: t('financy.dash.months3') }, { value: 6, label: t('financy.dash.months6') }]} />}
          >
            <div className="mb-2 flex flex-wrap gap-6 text-sm">
              <span>
                <span className="me-1 inline-block h-2 w-2 rounded-full" style={{ background: INCOME }} />
                {t('financy.dash.income')} <span className="ltr-nums font-semibold">{wholeIls(cashTotals.income)}</span>
              </span>
              <span>
                <span className="me-1 inline-block h-2 w-2 rounded-full" style={{ background: EXPENSE }} />
                {t('financy.dash.expenses')} <span className="ltr-nums font-semibold">{wholeIls(cashTotals.expenses)}</span>
              </span>
            </div>
            {cashTotals.income === 0 && cashTotals.expenses === 0 ? (
              <p className="py-8 text-center text-sm text-muted">{t('financy.dash.cashflowEmpty')}</p>
            ) : (
              <div className="h-56" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.cashflow} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fill: AXIS, fontSize: 12 }} />
                    <YAxis tickFormatter={compactIls} tick={{ fill: AXIS, fontSize: 12 }} width={56} />
                    <Tooltip content={<MoneyTooltip labelFormat={monthLabel} />} />
                    <Bar dataKey="expenses" name={t('financy.dash.expenses')} fill={EXPENSE} isAnimationActive={false} />
                    <Bar dataKey="income" name={t('financy.dash.income')} fill={INCOME} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <table data-testid="cashflow-table" className="mt-2 w-full text-start text-xs">
              <thead>
                <tr className="text-muted">
                  <th className="py-1 font-normal">{t('financy.dash.month')}</th>
                  <th className="font-normal">{t('financy.dash.income')}</th>
                  <th className="font-normal">{t('financy.dash.expenses')}</th>
                  <th className="font-normal">{t('financy.dash.net')}</th>
                </tr>
              </thead>
              <tbody>
                {d.cashflow.map((m) => (
                  <tr key={m.month} className="border-t border-line">
                    <td className="py-1">{monthLabel(m.month)}</td>
                    <td className="ltr-nums">{wholeIls(m.income)}</td>
                    <td className="ltr-nums">{wholeIls(m.expenses)}</td>
                    <td className="ltr-nums">{wholeIls(m.income - m.expenses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          {/* By category. */}
          <Panel
            testid="categories"
            title={t('financy.dash.byCategory')}
            aside={<Switch label={t('financy.dash.byCategory')} value={catMode} onChange={setCatMode} options={[{ value: 'expenses', label: t('financy.dash.expenses') }, { value: 'income', label: t('financy.dash.income') }]} />}
          >
            {cats.rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">{t('financy.dash.categoriesEmpty')}</p>
            ) : (
              <div className="flex flex-col items-center gap-4 sm:flex-row">
                <div className="relative h-44 w-44 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={cats.rows} dataKey="amount" nameKey="label" innerRadius="62%" outerRadius="100%" stroke="none" isAnimationActive={false}>
                        {cats.rows.map((c, i) => (
                          <Cell key={c.key} fill={catColor(c, i)} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xs text-muted">{t('financy.dash.total')}</span>
                    <span className="ltr-nums font-semibold text-ink">{wholeIls(cats.total)}</span>
                  </div>
                </div>
                <ul data-testid="category-list" className="flex w-full flex-col gap-2 text-sm">
                  {cats.rows.map((c, i) => (
                    <li key={c.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
                      <span className="flex items-center gap-2" dir="auto">
                        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: catColor(c, i) }} />
                        {catName(c)}
                      </span>
                      <span className="ltr-nums w-10 text-end text-xs text-muted">{Math.round(c.shareBp / 100)}%</span>
                      <span className="ltr-nums w-24 text-end font-semibold">{wholeIls(c.amount)}</span>
                      <span className="col-span-3 h-1 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
                        <span className="block h-full rounded-full" style={{ width: `${c.shareBp / 100}%`, background: catColor(c, i) }} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          {/* What waits to be matched. */}
          <section data-testid="to-match" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link to="/expenses/bank?status=unmatched&direction=out" className="rounded-card border border-line bg-surface p-4 shadow-card hover:bg-canvas">
              <p className="text-sm text-muted">{t('financy.dash.toMatchOutTitle')}</p>
              <p className="text-ink">{t('financy.dash.toMatchOut', { count: String(d.toMatch.out.count), amount: wholeIls(d.toMatch.out.sum) })}</p>
            </Link>
            <Link to="/expenses/bank?status=unmatched&direction=in" className="rounded-card border border-line bg-surface p-4 shadow-card hover:bg-canvas">
              <p className="text-sm text-muted">{t('financy.dash.toMatchInTitle')}</p>
              <p className="text-ink">{t('financy.dash.toMatchIn', { count: String(d.toMatch.in.count), amount: wholeIls(d.toMatch.in.sum) })}</p>
            </Link>
          </section>

          {/* Recent transactions. */}
          <Panel
            testid="recent"
            title={t('financy.dash.recent')}
            aside={
              <Link to={`/expenses/bank?month=${thisMonth}`} className="text-sm font-semibold text-accent-2 hover:underline">
                {t('financy.dash.showAll')}
              </Link>
            }
          >
            {rowError && (
              <p role="alert" className="mb-2 text-sm text-danger">
                {rowError}
              </p>
            )}
            {d.recent.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">{t('financy.dash.recentEmpty')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {d.recent.map((r) => (
                  <li key={r.id} data-testid={`recent-${r.id}`} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-canvas text-xs text-muted">
                        {(categoryLabel(r.categoryMain, locale) ?? '·').slice(0, 1)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink" dir="auto">
                          {r.merchant ?? r.description ?? t('financy.dash.noDescription')}
                        </p>
                        <p className="text-xs text-muted">
                          <span dir="auto">{categoryLabel(r.categoryMain, locale) ?? t('financy.dash.noCategory')}</span> · <span className="ltr-nums">{r.date}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <span className={`ltr-nums whitespace-nowrap font-semibold ${r.amountMinor > 0 ? 'text-success' : 'text-ink'}`}>
                        {r.amountMinor > 0 ? '+' : '−'}
                        {formatMoney(Math.abs(r.amountMinor), r.currency)}
                      </span>
                      <StatusCell tx={r} />
                      <RowActions tx={r} onChange={replaceRow} onError={setRowError} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* Accounts. */}
        <Panel
          testid="accounts"
          title={t('financy.dash.accounts')}
          aside={<Switch label={t('financy.dash.accounts')} value={showIls ? 'ils' : 'original'} onChange={(v) => setShowIls(v === 'ils')} options={[{ value: 'original', label: t('financy.dash.original') }, { value: 'ils', label: '₪' }]} />}
        >
          <div className="flex flex-col gap-4 text-sm">
            <div>
              <div className="flex items-start justify-between gap-2 rounded-md bg-canvas px-3 py-2">
                <span className="font-semibold">{t('financy.dash.checking', { count: String(d.accounts.checking.rows.length) })}</span>
                <span data-testid="checking-totals" className="ltr-nums text-end font-semibold">
                  {showIls
                    ? wholeIls(d.liquidity.cash)
                    : Object.entries(d.accounts.checking.totals).map(([cur, v]) => <span key={cur} className="block">{formatMoney(v, cur)}</span>)}
                </span>
              </div>
              {d.accounts.checking.rows.length === 0 ? (
                <p className="px-3 py-2 text-muted">{t('financy.dash.noChecking')}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {d.accounts.checking.rows.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-1 py-2.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <ProviderBadge provider={a.provider} />
                        <span className="min-w-0">
                          <span className="block truncate" dir="auto">
                            {a.name ?? t('financy.dash.account')}
                          </span>
                          {a.last4 && <span className="ltr-nums text-xs text-muted">··{a.last4}</span>}
                        </span>
                      </span>
                      <span className="ltr-nums text-end">
                        {showIls
                          ? wholeIls(a.balances.reduce((s, b) => s + (b.ilsMinor ?? 0), 0))
                          : a.balances.map((b) => (
                              <span key={b.currency} className="block">
                                {formatMoney(b.balanceMinor, b.currency)}
                              </span>
                            ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 rounded-md bg-canvas px-3 py-2">
                <span className="font-semibold">{t('financy.dash.cards', { count: String(d.accounts.cards.rows.length) })}</span>
                <span className="ltr-nums font-semibold">
                  {wholeIls(d.accounts.cards.totalCurrent)} <span className="text-xs font-normal text-muted">{t('financy.dash.currentMonth')}</span>
                </span>
              </div>
              {d.accounts.cards.rows.length === 0 ? (
                <p className="px-3 py-2 text-muted">{t('financy.dash.noCards')}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {d.accounts.cards.rows.map((c) => (
                    <li key={c.id} data-testid={`card-${c.id}`} className={`flex items-center justify-between gap-3 px-1 py-2.5 ${c.blocked ? 'opacity-50' : ''}`}>
                      <span className="flex min-w-0 items-center gap-2">
                        <ProviderBadge provider={c.provider} />
                        <span className="min-w-0">
                          <span className="block truncate" dir="auto">
                            {c.name ?? t('financy.dash.card')}
                          </span>
                          <span className="text-xs text-muted">
                            {c.last4 && <span className="ltr-nums">··{c.last4}</span>}
                            {c.blocked && <span className="ms-2">{t('financy.dash.blocked')}</span>}
                          </span>
                        </span>
                      </span>
                      <span className="text-end">
                        <span className="ltr-nums block font-semibold">{wholeIls(c.currentMinor)}</span>
                        <span className="ltr-nums block text-xs text-muted">{t('financy.dash.lastStatement', { amount: wholeIls(c.statementMinor ?? 0) })}</span>
                        {c.dueDay && !c.dueDay.includes('-') && <span className="block text-xs text-muted">{t('financy.dash.dueDay', { day: c.dueDay })}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
