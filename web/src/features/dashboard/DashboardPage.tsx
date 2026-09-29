import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { useIssuing } from '../../app/issuing';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ComposedChart, LabelList, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  type AgingBucket,
  type DashboardCard,
  type DashboardData,
  type DashboardQuery,
  DEFAULT_LAYOUT,
  type LayoutEntry,
  type PeriodCard,
  type Range,
  fetchDashboard,
} from '../../api/dashboard';
import { usePreferences } from '../../app/preferences';
import { CeilingMeter } from '../../components/CeilingMeter';
import { EmptyState } from '../../components/EmptyState';
import { MoneyCell } from '../../components/MoneyCell';
import { StatusChip } from '../../components/StatusChip';
import { type MessageKey, useT } from '../../i18n';
import { formatMoney } from '../../lib/money';
import { type Period, type PeriodPreset, PeriodControl, todayIsrael, usePeriod } from '../reports/period';
import {
  AXIS,
  ChartTable,
  DonutWithTable,
  GRID,
  INK,
  MoneyTooltip,
  SERIES,
  SERIES_SOFT,
  Swatch,
  compactIls,
  originalAmounts,
  useIsRtl,
  useMonthLabel,
} from './charts';

/**
 * R21 dashboard, modelled on Wave's dashboard and SUMIT's "תקציר מנהלים". Cards render in the
 * order and visibility set in Settings > Dashboard. The first load is one API call that returns
 * the layout and every visible card. Changing one card's period refetches that card alone.
 */

interface Tile {
  label: MessageKey;
  to: string;
  tone: 'blue' | 'green' | 'peach' | 'lilac';
}

const TILES: Tile[] = [
  { label: 'dashboard.tileNewQuote', to: '/income/quotes/new', tone: 'blue' },
  { label: 'dashboard.tileNewPaymentRequest', to: '/income/payment-requests/new', tone: 'green' },
  { label: 'dashboard.tileRecordPayment', to: '/income/documents/new?type=400', tone: 'peach' },
  { label: 'dashboard.tileUploadExpense', to: '/expenses', tone: 'lilac' },
];

/** With issuing off, the tiles that start a document give way to import. */
const TILES_NO_ISSUING: Tile[] = [
  { label: 'dashboard.tileUploadExpense', to: '/expenses', tone: 'lilac' },
  { label: 'dashboard.tileImportDocuments', to: '/import', tone: 'blue' },
];

const TILE_CLASS: Record<Tile['tone'], string> = {
  blue: 'bg-tile-blue',
  green: 'bg-tile-green',
  peach: 'bg-tile-peach',
  lilac: 'bg-tile-lilac',
};

export const CARD_TITLES: Record<DashboardCard, MessageKey> = {
  quickActions: 'dash.card.quickActions',
  overdue: 'dash.card.overdue',
  cashFlow: 'dash.card.cashFlow',
  profitLoss: 'dash.card.profitLoss',
  incomeByMonth: 'dash.card.incomeByMonth',
  topClients: 'dash.card.topClients',
  topServices: 'dash.card.topServices',
  expenseCategories: 'dash.card.expenseCategories',
  yearComparison: 'dash.card.yearComparison',
  aging: 'dash.card.aging',
  ceiling: 'dashboard.osekPaturCeiling',
  vat: 'dashboard.vatDue',
  ita: 'dashboard.itaStatus',
};

/** The report behind each card, for its "View report" link. */
const CARD_REPORT: Partial<Record<DashboardCard, string>> = {
  overdue: 'open-payment-requests',
  cashFlow: 'cash-flow',
  profitLoss: 'profit-loss',
  incomeByMonth: 'income',
  topClients: 'income-by-client',
  topServices: 'sales-by-service',
  expenseCategories: 'expenses-by-category',
  yearComparison: 'annual-summary',
  aging: 'aged-receivables',
  ceiling: 'ceiling',
};

const WIDE: DashboardCard[] = ['quickActions', 'overdue', 'cashFlow'];

const PERIOD_DEFAULTS: Record<PeriodCard, { preset: PeriodPreset; options?: PeriodPreset[] }> = {
  cashFlow: { preset: 'last12', options: ['last12', 'last24'] },
  profitLoss: { preset: 'last12' },
  incomeByMonth: { preset: 'thisYear' },
  topClients: { preset: 'thisYear' },
  topServices: { preset: 'thisYear' },
  expenseCategories: { preset: 'thisYear' },
};

export function reportLink(report: string, params: Record<string, string> = {}): string {
  return `/reports?${new URLSearchParams({ report, ...params }).toString()}`;
}

function Card({ id, title, period, children, wide, reportTo }: { id: string; title: string; period?: ReactNode; children: ReactNode; wide?: boolean; reportTo?: string }) {
  const t = useT();
  return (
    <section aria-labelledby={`card-${id}`} data-card={id} className={`flex flex-col rounded-card border border-line bg-canvas p-5 shadow-card ${wide ? 'lg:col-span-2' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`card-${id}`} className="text-sm font-semibold uppercase tracking-wide text-muted">
          {title}
        </h2>
        {period}
      </div>
      <div className="mt-3 flex-1">{children}</div>
      {reportTo && (
        <div className="mt-3 border-t border-line pt-3">
          <Link to={reportTo} className="text-sm font-semibold text-accent-2 hover:underline">
            {t('dash.viewReport')}
          </Link>
        </div>
      )}
    </section>
  );
}

function ImportedNote({ show }: { show: boolean }) {
  const t = useT();
  if (!show) return null;
  return (
    <p className="mt-2 text-xs text-muted">
      <Swatch color={SERIES_SOFT} />
      {t('dash.importedNote')}
    </p>
  );
}

/** Legend labels wear the ink token. The swatch beside them carries the series color. */
const legendText = (value: unknown) => <span style={{ color: INK }}>{String(value)}</span>;

function useAxis() {
  const rtl = useIsRtl();
  const month = useMonthLabel();
  return {
    x: { dataKey: 'month', stroke: AXIS, fontSize: 11, tickFormatter: month, reversed: rtl, tickLine: false },
    y: { stroke: AXIS, fontSize: 11, width: 56, tickFormatter: compactIls, orientation: rtl ? ('right' as const) : ('left' as const), axisLine: false, tickLine: false },
    month,
  };
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function OverdueCard({ data }: { data: NonNullable<DashboardData['cards']['overdue']> }) {
  const t = useT();
  const { locale } = usePreferences();
  if (data.items.length === 0) return <EmptyState title={t('dashboard.nothingOverdue')} description={t('dash.overdue.emptyDescription')} />;
  const shown = data.items.slice(0, 8);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-sm">
        {data.overdueRequests.map((r) => (
          <span key={`r-${r.currency}`} className="flex items-center gap-2">
            <StatusChip tone="danger">{t('dashboard.overdue')}</StatusChip>
            {r.count === 1 ? t('dashboard.requestCount', { count: r.count }) : t('dashboard.requestCountPlural', { count: r.count })}
            <span className="ltr-nums font-semibold">{formatMoney(r.totalMinor, r.currency)}</span>
          </span>
        ))}
        {data.openProformas.map((r) => (
          <span key={`p-${r.currency}`} className="flex items-center gap-2">
            <StatusChip tone="neutral">{t('dash.overdue.openProformas')}</StatusChip>
            <span className="ltr-nums font-semibold">{formatMoney(r.totalMinor, r.currency)}</span>
          </span>
        ))}
      </div>
      <ChartTable
        caption={t('dash.card.overdue')}
        rows={shown}
        rowKey={(i) => (i.imported ? `x${i.documentId}` : String(i.documentId))}
        columns={[
          {
            key: 'doc',
            header: t('dash.col.document'),
            render: (i) => {
              const label = (locale === 'he' ? i.typeNameHe : i.typeNameEn) + (i.displayNumber ? ` ${i.displayNumber}` : '');
              // An imported document opens its original PDF.
              return i.imported ? (
                <a href={`/api/import/external-documents/${i.documentId}/file`} target="_blank" rel="noreferrer" className="text-accent-2 hover:underline" dir="auto">
                  {label}
                </a>
              ) : (
                <Link to={`/income/documents/${i.documentId}`} className="text-accent-2 hover:underline">
                  {label}
                </Link>
              );
            },
          },
          { key: 'client', header: t('dash.col.client'), render: (i) => (locale === 'he' ? i.clientNameHe : i.clientNameEn) || t('dash.noClient') },
          {
            key: 'age',
            header: t('dash.col.age'),
            numeric: true,
            render: (i) => (i.daysOverdue > 0 ? t('dash.daysOverdue', { days: i.daysOverdue }) : t('dash.notDueYet')),
          },
          { key: 'amount', header: t('dash.col.open'), numeric: true, render: (i) => <MoneyCell amountMinor={i.remainingMinor} currency={i.currency} ilsMinor={i.ilsMinor} /> },
        ]}
      />
      {data.items.length > shown.length && <p className="mt-2 text-xs text-muted">{t('dash.moreItems', { count: data.items.length - shown.length })}</p>}
    </div>
  );
}

function CashFlowCard({ data }: { data: NonNullable<DashboardData['cards']['cashFlow']> }) {
  const t = useT();
  const axis = useAxis();
  const hasImported = data.months.some((m) => m.importedInflowIlsMinor !== 0);
  const total = (k: 'inflowIlsMinor' | 'importedInflowIlsMinor' | 'outflowIlsMinor' | 'netIlsMinor') => data.months.reduce((s, m) => s + m[k], 0);
  return (
    <div>
      <div className="h-60" role="img" aria-label={t('dash.card.cashFlow')}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.months} stackOffset="sign" barGap={2}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis {...axis.x} />
            <YAxis {...axis.y} />
            <ReferenceLine y={0} stroke={AXIS} />
            <Tooltip content={<MoneyTooltip labelFormat={axis.month} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
            <Bar dataKey="inflowIlsMinor" stackId="flow" name={t('dash.inflow')} fill={SERIES[0]} isAnimationActive={false} />
            {hasImported && <Bar dataKey="importedInflowIlsMinor" stackId="flow" name={t('dash.importedInflow')} fill={SERIES_SOFT} isAnimationActive={false} />}
            <Bar dataKey="outflowIlsMinor" stackId="flow" name={t('dash.outflow')} fill={SERIES[1]} radius={[0, 0, 4, 4]} isAnimationActive={false} />
            <Line dataKey="netIlsMinor" name={t('dash.netChange')} stroke={INK} strokeWidth={2} dot={{ r: 4, strokeWidth: 0, fill: INK }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ImportedNote show={hasImported} />
      <ChartTable
        caption={t('dash.card.cashFlow')}
        rows={data.months}
        rowKey={(m) => m.month}
        columns={[
          { key: 'month', header: t('dash.col.month'), render: (m) => axis.month(m.month) },
          { key: 'in', header: t('dash.inflow'), numeric: true, render: (m) => formatMoney(m.inflowIlsMinor + m.importedInflowIlsMinor, 'ILS') },
          { key: 'out', header: t('dash.outflow'), numeric: true, render: (m) => formatMoney(m.outflowIlsMinor, 'ILS') },
          { key: 'net', header: t('dash.netChange'), numeric: true, render: (m) => formatMoney(m.netIlsMinor, 'ILS') },
        ]}
        footer={
          <tr>
            <td className="py-1 pe-2">{t('dash.total')}</td>
            <td className="ltr-nums py-1 pe-2 text-end">{formatMoney(total('inflowIlsMinor') + total('importedInflowIlsMinor'), 'ILS')}</td>
            <td className="ltr-nums py-1 pe-2 text-end">{formatMoney(total('outflowIlsMinor'), 'ILS')}</td>
            <td className="ltr-nums py-1 pe-2 text-end">{formatMoney(total('netIlsMinor'), 'ILS')}</td>
          </tr>
        }
      />
    </div>
  );
}

function ProfitLossCard({ data }: { data: NonNullable<DashboardData['cards']['profitLoss']> }) {
  const t = useT();
  const axis = useAxis();
  const hasImported = data.months.some((m) => m.importedIncomeIlsMinor !== 0);
  const sum = (k: 'incomeIlsMinor' | 'importedIncomeIlsMinor' | 'expensesIlsMinor' | 'netIlsMinor') => data.months.reduce((s, m) => s + m[k], 0);
  return (
    <div>
      <div className="h-56" role="img" aria-label={t('dash.card.profitLoss')}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.months} barGap={2}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis {...axis.x} />
            <YAxis {...axis.y} />
            <Tooltip content={<MoneyTooltip labelFormat={axis.month} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
            <Bar dataKey="incomeIlsMinor" stackId="income" name={t('dashboard.income')} fill={SERIES[0]} radius={hasImported ? undefined : [4, 4, 0, 0]} isAnimationActive={false} />
            {hasImported && <Bar dataKey="importedIncomeIlsMinor" stackId="income" name={t('dash.importedIncome')} fill={SERIES_SOFT} radius={[4, 4, 0, 0]} isAnimationActive={false} />}
            <Bar dataKey="expensesIlsMinor" name={t('dashboard.expenses')} fill={SERIES[1]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ImportedNote show={hasImported} />
      <ChartTable
        caption={t('dash.card.profitLoss')}
        rows={data.months}
        rowKey={(m) => m.month}
        columns={[
          { key: 'month', header: t('dash.col.month'), render: (m) => axis.month(m.month) },
          { key: 'income', header: t('dashboard.income'), numeric: true, render: (m) => formatMoney(m.incomeIlsMinor + m.importedIncomeIlsMinor, 'ILS') },
          { key: 'expenses', header: t('dashboard.expenses'), numeric: true, render: (m) => formatMoney(m.expensesIlsMinor, 'ILS') },
          { key: 'net', header: t('dash.net'), numeric: true, render: (m) => formatMoney(m.netIlsMinor, 'ILS') },
        ]}
        footer={
          <tr>
            <td className="py-1 pe-2">{t('dash.total')}</td>
            <td className="ltr-nums py-1 pe-2 text-end">{formatMoney(sum('incomeIlsMinor') + sum('importedIncomeIlsMinor'), 'ILS')}</td>
            <td className="ltr-nums py-1 pe-2 text-end">{formatMoney(sum('expensesIlsMinor'), 'ILS')}</td>
            <td className="ltr-nums py-1 pe-2 text-end">{formatMoney(sum('netIlsMinor'), 'ILS')}</td>
          </tr>
        }
      />
    </div>
  );
}

function IncomeByMonthCard({ data }: { data: NonNullable<DashboardData['cards']['incomeByMonth']> }) {
  const t = useT();
  const axis = useAxis();
  const hasImported = data.importedIlsMinor !== 0;
  const legend = `${t('dashboard.income')} ${formatMoney(data.totalIlsMinor, 'ILS')}`;
  return (
    <div>
      <div className="h-56" role="img" aria-label={t('dash.card.incomeByMonth')}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.months} margin={{ top: 18 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis {...axis.x} />
            <YAxis {...axis.y} />
            <Tooltip content={<MoneyTooltip labelFormat={axis.month} />} />
            <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
            <Bar dataKey="issuedIlsMinor" stackId="income" name={legend} fill={SERIES[0]} radius={hasImported ? undefined : [4, 4, 0, 0]} isAnimationActive={false}>
              {!hasImported && <LabelList dataKey="totalIlsMinor" position="top" fontSize={10} fill={INK} formatter={(v: unknown) => (Number(v) ? compactIls(Number(v)) : '')} />}
            </Bar>
            {hasImported && (
              <Bar dataKey="importedIlsMinor" stackId="income" name={t('dash.importedIncome')} fill={SERIES_SOFT} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                <LabelList dataKey="totalIlsMinor" position="top" fontSize={10} fill={INK} formatter={(v: unknown) => (Number(v) ? compactIls(Number(v)) : '')} />
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ImportedNote show={hasImported} />
      <ChartTable
        caption={t('dash.card.incomeByMonth')}
        rows={data.months}
        rowKey={(m) => m.month}
        columns={[
          { key: 'month', header: t('dash.col.month'), render: (m) => axis.month(m.month) },
          ...(hasImported ? [{ key: 'imported', header: t('dash.importedIncome'), numeric: true, render: (m: (typeof data.months)[number]) => formatMoney(m.importedIlsMinor, 'ILS') }] : []),
          { key: 'total', header: t('dash.col.amountIls'), numeric: true, render: (m) => formatMoney(m.totalIlsMinor, 'ILS') },
        ]}
        footer={
          <tr>
            <td className="py-1 pe-2">{t('dash.total')}</td>
            {hasImported && <td className="ltr-nums py-1 pe-2 text-end">{formatMoney(data.importedIlsMinor, 'ILS')}</td>}
            <td className="ltr-nums py-1 pe-2 text-end">{formatMoney(data.totalIlsMinor, 'ILS')}</td>
          </tr>
        }
      />
    </div>
  );
}

function YearComparisonCard({ data }: { data: NonNullable<DashboardData['cards']['yearComparison']> }) {
  const t = useT();
  const { previousYear: prev, samePeriodLastYear: same, yearToDate: ytd } = data;
  const change = (now: number, before: number) => (before === 0 ? '' : `${now >= before ? '+' : ''}${Math.round(((now - before) / Math.abs(before)) * 100)}%`);
  const rows = [
    { key: 'income', label: t('dashboard.income'), f: (y: typeof prev) => y.incomeIlsMinor },
    { key: 'expenses', label: t('dashboard.expenses'), f: (y: typeof prev) => y.expensesIlsMinor },
    { key: 'net', label: t('dash.net'), f: (y: typeof prev) => y.netIlsMinor },
  ];
  return (
    <ChartTable
      caption={t('dash.card.yearComparison')}
      rows={rows}
      rowKey={(r) => r.key}
      columns={[
        { key: 'label', header: '', render: (r) => <span className="font-semibold">{r.label}</span> },
        { key: 'prev', header: prev.from.slice(0, 4), numeric: true, render: (r) => formatMoney(r.f(prev), 'ILS') },
        { key: 'same', header: t('dash.samePeriod', { year: same.from.slice(0, 4) }), numeric: true, render: (r) => formatMoney(r.f(same), 'ILS') },
        { key: 'ytd', header: t('dash.yearToDate', { year: ytd.from.slice(0, 4) }), numeric: true, render: (r) => formatMoney(r.f(ytd), 'ILS') },
        { key: 'change', header: t('dash.change'), numeric: true, render: (r) => change(r.f(ytd), r.f(same)) },
      ]}
    />
  );
}

const BUCKET_LABELS: Record<AgingBucket, MessageKey> = {
  current: 'dash.bucket.current',
  '1-30': 'dash.bucket.1to30',
  '31-60': 'dash.bucket.31to60',
  '61-90': 'dash.bucket.61to90',
  '90+': 'dash.bucket.over90',
};

function AgingCard({ data }: { data: NonNullable<DashboardData['cards']['aging']> }) {
  const t = useT();
  const max = Math.max(1, ...data.buckets.map((b) => b.ilsMinor));
  return (
    <ul className="flex flex-col gap-2">
      {data.buckets.map((b) => {
        const orig = originalAmounts(b.byCurrency);
        return (
          <li key={b.bucket}>
            <Link to={reportLink('aged-receivables', { bucket: b.bucket })} className="block rounded-md px-2 py-1 hover:bg-surface" title={orig || undefined}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-ink">{t(BUCKET_LABELS[b.bucket])}</span>
                <span className="text-xs text-muted">{t('dash.count', { count: b.count })}</span>
                <span className="ltr-nums ms-auto font-semibold text-ink">{formatMoney(b.ilsMinor, 'ILS')}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-surface">
                <div className="h-2 rounded-full" style={{ width: `${Math.round((b.ilsMinor / max) * 100)}%`, background: SERIES[0] }} />
              </div>
              {orig && <p className="ltr-nums mt-1 text-[10px] text-muted">{orig}</p>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface DashboardPageProps {
  /** Injected in tests. Defaults to GET /api/dashboard. */
  loadDashboard?: (query: DashboardQuery) => Promise<DashboardData>;
  /** Business date, injected in tests. Default: today in Israel. */
  today?: string;
}

function usePeriodCard(card: PeriodCard, today: string) {
  const d = PERIOD_DEFAULTS[card];
  const [period, setPeriod] = usePeriod(`dashboard.${card}`, d.preset, d.options, today);
  return { card, period, setPeriod, options: d.options };
}

export function DashboardPage({ loadDashboard = fetchDashboard, today = todayIsrael() }: DashboardPageProps) {
  const t = useT();
  const issuing = useIssuing();
  const [data, setData] = useState<DashboardData | null>(null);
  const [layout, setLayout] = useState<LayoutEntry[]>(DEFAULT_LAYOUT);
  const [error, setError] = useState<string | null>(null);

  const periods = {
    cashFlow: usePeriodCard('cashFlow', today),
    profitLoss: usePeriodCard('profitLoss', today),
    incomeByMonth: usePeriodCard('incomeByMonth', today),
    topClients: usePeriodCard('topClients', today),
    topServices: usePeriodCard('topServices', today),
    expenseCategories: usePeriodCard('expenseCategories', today),
  };
  const ranges = Object.fromEntries(Object.values(periods).map((p) => [p.card, { from: p.period.from, to: p.period.to }])) as Record<PeriodCard, Range>;
  const rangesRef = useRef(ranges);
  rangesRef.current = ranges;

  useEffect(() => {
    let live = true;
    loadDashboard({ ranges: rangesRef.current })
      .then((d) => {
        if (!live) return;
        setData(d);
        if (d.layout) setLayout(d.layout);
      })
      .catch(() => live && setError(t('dashboard.loadError')));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadDashboard]);

  function changePeriod(card: PeriodCard, p: Period) {
    periods[card].setPeriod(p);
    loadDashboard({ cards: [card], ranges: { [card]: { from: p.from, to: p.to } } })
      .then((d) => setData((prev) => (prev ? { ...prev, cards: { ...prev.cards, ...d.cards } } : d)))
      .catch(() => setError(t('dashboard.loadError')));
  }

  function periodControl(card: PeriodCard) {
    const p = periods[card];
    return <PeriodControl value={p.period} onChange={(next) => changePeriod(card, next)} options={p.options} today={today} label={t(CARD_TITLES[card])} />;
  }

  function linkFor(card: DashboardCard): string | undefined {
    const report = CARD_REPORT[card];
    if (!report) return undefined;
    const p = (periods as Partial<Record<DashboardCard, ReturnType<typeof usePeriodCard>>>)[card];
    return reportLink(report, p ? { from: p.period.from, to: p.period.to } : {});
  }

  function renderCard(card: DashboardCard): ReactNode {
    const title = t(CARD_TITLES[card]);
    const common = { id: card, title, wide: WIDE.includes(card), reportTo: linkFor(card) };
    if (card === 'quickActions') {
      return (
        <Card {...common} reportTo={undefined}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(issuing ? TILES : TILES_NO_ISSUING).map((tile) => (
              <Link key={tile.label} to={tile.to} className={`rounded-card p-4 text-sm font-semibold text-ink shadow-card hover:opacity-90 ${TILE_CLASS[tile.tone]}`}>
                {t(tile.label)}
              </Link>
            ))}
          </div>
        </Card>
      );
    }
    if (!data) return null;
    const c = data.cards;
    switch (card) {
      case 'overdue':
        return c.overdue ? <Card {...common}><OverdueCard data={c.overdue} /></Card> : null;
      case 'cashFlow':
        return c.cashFlow ? <Card {...common} period={periodControl('cashFlow')}><CashFlowCard data={c.cashFlow} /></Card> : null;
      case 'profitLoss':
        return c.profitLoss ? <Card {...common} period={periodControl('profitLoss')}><ProfitLossCard data={c.profitLoss} /></Card> : null;
      case 'incomeByMonth':
        return c.incomeByMonth ? <Card {...common} period={periodControl('incomeByMonth')}><IncomeByMonthCard data={c.incomeByMonth} /></Card> : null;
      case 'topClients':
        return c.topClients ? (
          <Card {...common} period={periodControl('topClients')}>
            {c.topClients.rows.length === 0 ? (
              <EmptyState title={t('dash.noIncome')} />
            ) : (
              <DonutWithTable {...c.topClients} caption={title} nameHeader={t('dash.col.client')} importedLabel={t('dash.imported')} />
            )}
          </Card>
        ) : null;
      case 'topServices':
        return c.topServices ? (
          <Card {...common} period={periodControl('topServices')}>
            {c.topServices.rows.length === 0 ? <EmptyState title={t('dash.noIncome')} /> : <DonutWithTable {...c.topServices} caption={title} nameHeader={t('dash.col.service')} />}
          </Card>
        ) : null;
      case 'expenseCategories':
        return c.expenseCategories ? (
          <Card {...common} period={periodControl('expenseCategories')}>
            {c.expenseCategories.rows.length === 0 ? (
              <EmptyState title={t('dashboard.noExpensesYet')} description={t('dash.noExpensesDescription')} />
            ) : (
              <DonutWithTable {...c.expenseCategories} caption={title} nameHeader={t('dash.col.category')} />
            )}
          </Card>
        ) : null;
      case 'yearComparison':
        return c.yearComparison ? <Card {...common}><YearComparisonCard data={c.yearComparison} /></Card> : null;
      case 'aging':
        return c.aging ? <Card {...common}><AgingCard data={c.aging} /></Card> : null;
      case 'ceiling':
        return (
          <Card {...common}>
            {data.ceiling ? (
              <CeilingMeter year={data.ceiling.year} currency={data.ceiling.currency} limitMinor={data.ceiling.limitMinor} currentMinor={data.ceiling.currentMinor} />
            ) : (
              <EmptyState title={t('dashboard.noCeilingSet')} description={t('dashboard.noCeilingSetDescription')} />
            )}
          </Card>
        );
      case 'vat':
        return (
          <Card {...common}>
            {data.vatDue.applicable ? (
              <p className="text-2xl font-semibold text-ink ltr-nums">{formatMoney(data.vatDue.amountMinor, data.vatDue.currency)}</p>
            ) : (
              <EmptyState title={t('dashboard.noVatYet')} description={t('dashboard.noVatYetDescription')} />
            )}
          </Card>
        );
      case 'ita':
        return (
          <Card {...common}>
            <div className="flex items-center gap-2">
              <StatusChip tone={data.ita.connected ? 'success' : 'neutral'}>{data.ita.connected ? t('dashboard.itaConnected') : t('dashboard.itaNotConnected')}</StatusChip>
              <p className="text-sm text-muted">{data.ita.message}</p>
            </div>
          </Card>
        );
      default:
        return null;
    }
  }

  const visible = layout.filter((e) => e.visible).map((e) => e.id);

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="page-title" className="font-heading text-3xl text-ink">
          {t('dashboard.title')}
        </h1>
        <Link to="/settings?tab=dashboard" className="text-sm font-semibold text-accent-2 hover:underline">
          {t('dash.customize')}
        </Link>
      </div>

      {error && (
        <p role="alert" className="mt-6 text-sm text-danger">
          {error}
        </p>
      )}
      {!data && !error && <p className="mt-6 text-sm text-muted">{t('dashboard.loading')}</p>}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {visible.map((card) => (
          <Fragment key={card}>{renderCard(card)}</Fragment>
        ))}
      </div>
    </section>
  );
}
