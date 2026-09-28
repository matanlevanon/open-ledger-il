import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type Cell, type MoneyValue, type ReportColumn, type ReportLink, type ReportResult, fetchReport, reportQuery } from '../../api/reports';
import { EmptyState } from '../../components/EmptyState';
import { MoneyCell } from '../../components/MoneyCell';
import { type MessageKey, useT } from '../../i18n';
import { formatMoney } from '../../lib/money';
import { useMonthLabel } from '../dashboard/charts';
import { ErrorNote, Loading } from '../documents/ui';
import { previousRange } from './period';

/** Column headers, keyed by the English header the Worker sends. An unknown header shows as sent. */
const HEADER_KEYS: Record<string, MessageKey> = {
  Document: 'rcol.document',
  Client: 'rcol.client',
  Date: 'rcol.date',
  Due: 'rcol.due',
  'Days late': 'rcol.daysLate',
  Bucket: 'rcol.bucket',
  Open: 'rcol.open',
  'Open ILS': 'rcol.openIls',
  'Open documents': 'rcol.openDocuments',
  'Open balance': 'rcol.openBalance',
  Documents: 'rcol.documents',
  'Paid, original currency': 'rcol.paidOriginal',
  'Paid ILS': 'rcol.paidIls',
  'Unpaid ILS': 'rcol.unpaidIls',
  'Total ILS': 'rcol.totalIls',
  Type: 'rcol.type',
  Number: 'rcol.number',
  Status: 'rcol.status',
  Amount: 'rcol.amount',
  'Amount ILS': 'rcol.amountIls',
  Service: 'rcol.service',
  Quantity: 'rcol.quantity',
  'Amount, original currency': 'rcol.amountOriginal',
  'Payment method': 'rcol.paymentMethod',
  Payments: 'rcol.payments',
  Credit: 'rcol.credit',
  Credits: 'rcol.credits',
  Reason: 'rcol.reason',
  Supplier: 'rcol.supplier',
  Expenses: 'rcol.expenses',
  Category: 'rcol.category',
  Month: 'rcol.month',
  'Fixed ILS': 'rcol.fixedIls',
  'One-off ILS': 'rcol.oneOffIls',
  'Not marked ILS': 'rcol.notMarkedIls',
  Fixed: 'rcol.fixed',
  'Money in ILS': 'rcol.moneyIn',
  'Money in, imported ILS': 'rcol.moneyInImported',
  'Money out ILS': 'rcol.moneyOut',
  'Net change ILS': 'rcol.netChange',
  Year: 'rcol.year',
  Line: 'rcol.line',
};

/** Fixed cell values the Worker sends in English. */
const VALUE_KEYS: Record<string, MessageKey> = {
  current: 'dash.bucket.current',
  '1-30': 'dash.bucket.1to30',
  '31-60': 'dash.bucket.31to60',
  '61-90': 'dash.bucket.61to90',
  '90+': 'dash.bucket.over90',
  final: 'rval.final',
  cancelled: 'rval.cancelled',
  draft: 'rval.draft',
  imported: 'dash.imported',
  Uncategorized: 'rval.uncategorized',
  'No client': 'dash.noClient',
  Fixed: 'rval.fixed',
  'One-off': 'rval.oneOff',
  'Income, Open Ledger IL documents': 'rval.incomeIssued',
  'Income, imported documents': 'rval.incomeImported',
  'Total income': 'rval.totalIncome',
  'Total expenses': 'rval.totalExpenses',
  'Net income': 'rval.netIncome',
  'Imported, method not recorded': 'rval.importedMethod',
};

export function linkPath(link: ReportLink): string {
  switch (link.kind) {
    case 'document':
      return `/income/documents/${link.id}`;
    case 'expense':
      return `/expenses/${link.id}`;
    case 'client':
      return `/clients/${link.id}`;
    case 'report':
      return `/reports?${new URLSearchParams({ report: link.report, ...link.params }).toString()}`;
  }
}

function isMoney(v: Cell | undefined): v is MoneyValue {
  return typeof v === 'object' && v !== null && 'minor' in v && 'currency' in v;
}

function useCellRenderer() {
  const t = useT();
  const month = useMonthLabel();
  const text = (v: string): string => {
    if (VALUE_KEYS[v]) return t(VALUE_KEYS[v]);
    if (v.startsWith('Expenses: ')) return `${t('rval.expensesPrefix')} ${text(v.slice(10))}`;
    return v;
  };
  return (col: ReportColumn, v: Cell | undefined) => {
    if (v === null || v === undefined || v === '') return '';
    switch (col.kind) {
      case 'ils':
        return <span className="ltr-nums">{formatMoney(v as number, 'ILS')}</span>;
      case 'money':
        return isMoney(v) ? <MoneyCell amountMinor={v.minor} currency={v.currency} /> : '';
      case 'moneyList':
        return (
          <span className="ltr-nums">
            {Object.entries(v as Record<string, number>)
              .map(([c, m]) => formatMoney(m, c))
              .join(' + ')}
          </span>
        );
      case 'quantity':
        return <span className="ltr-nums">{((v as number) / 1000).toLocaleString('en', { maximumFractionDigits: 3 })}</span>;
      case 'int':
      case 'date':
        return <span className="ltr-nums">{String(v)}</span>;
      case 'month':
        return month(String(v));
      default:
        return text(String(v));
    }
  };
}

const numeric = (c: ReportColumn) => ['ils', 'money', 'moneyList', 'int', 'quantity'].includes(c.kind);

interface CatalogReportProps {
  id: string;
  from: string;
  to: string;
  filters: Record<string, string>;
  /** The ILS column to compare with the previous period, when the toggle is on. */
  compareColumn?: string;
  compare: boolean;
  /** Injected in tests. */
  load?: typeof fetchReport;
}

/** Any catalog report: a table with totals, a link on every row, and CSV and XLSX downloads. */
export function CatalogReport({ id, from, to, filters, compareColumn, compare, load = fetchReport }: CatalogReportProps) {
  const t = useT();
  const render = useCellRenderer();
  const [data, setData] = useState<ReportResult | null>(null);
  const [previous, setPrevious] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filterKey = JSON.stringify(filters);
  const comparing = compare && !!compareColumn;

  useEffect(() => {
    let live = true;
    setData(null);
    setPrevious(null);
    setError(null);
    const prev = previousRange(from, to);
    Promise.all([load(id, from, to, filters), comparing ? load(id, prev.from, prev.to, filters) : Promise.resolve(null)])
      .then(([current, before]) => {
        if (!live) return;
        setData(current);
        setPrevious(before);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : t('documents.error.generic')));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, from, to, filterKey, comparing]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;

  const qs = reportQuery(from, to, filters);
  const prevByKey = new Map((previous?.rows ?? []).map((r) => [r.key, r.cells[compareColumn ?? ''] as number | null]));
  const header = (c: ReportColumn) => (HEADER_KEYS[c.header] ? t(HEADER_KEYS[c.header]!) : c.header);
  const change = (now: number, before: number | null | undefined) => {
    if (!before) return '';
    return `${now >= before ? '+' : ''}${Math.round(((now - before) / Math.abs(before)) * 100)}%`;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-4">
        <a href={`/api/reports/r/${id}/csv?${qs}`} className="text-sm font-semibold text-accent-2 hover:underline">
          {t('reports.downloadCsv')}
        </a>
        <a href={`/api/reports/r/${id}/xlsx?${qs}`} className="text-sm font-semibold text-accent-2 hover:underline">
          {t('reports.downloadXlsx')}
        </a>
      </div>
      {data.rows.length === 0 ? (
        <EmptyState title={t('rep.empty')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase text-muted">
                {data.columns.map((c) => (
                  <th key={c.key} scope="col" className={`px-2 py-2 ${numeric(c) ? 'text-end' : 'text-start'}`}>
                    {header(c)}
                  </th>
                ))}
                {comparing && (
                  <>
                    <th scope="col" className="px-2 py-2 text-end">
                      {t('rep.previousPeriod')}
                    </th>
                    <th scope="col" className="px-2 py-2 text-end">
                      {t('dash.change')}
                    </th>
                  </>
                )}
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const before = prevByKey.get(r.key);
                const now = (r.cells[compareColumn ?? ''] as number | null) ?? 0;
                return (
                  <tr key={r.key} className="border-t border-line align-top">
                    {data.columns.map((c, i) => (
                      <td key={c.key} className={`px-2 py-2 text-ink ${numeric(c) ? 'text-end' : ''}`}>
                        {i === 0 && r.link ? (
                          <Link to={linkPath(r.link)} className="text-accent-2 hover:underline">
                            {render(c, r.cells[c.key]) || t('rep.open')}
                          </Link>
                        ) : (
                          render(c, r.cells[c.key])
                        )}
                        {i === 0 && r.imported && <span className="ms-2 rounded bg-surface px-1 text-[10px] uppercase text-muted">{t('dash.imported')}</span>}
                      </td>
                    ))}
                    {comparing && (
                      <>
                        <td className="ltr-nums px-2 py-2 text-end text-muted">{before == null ? '' : formatMoney(before, 'ILS')}</td>
                        <td className="ltr-nums px-2 py-2 text-end">{change(now, before)}</td>
                      </>
                    )}
                    <td className="px-2 py-2 text-end">
                      {r.link && (
                        <Link to={linkPath(r.link)} aria-label={t('rep.drillDown')} className="text-muted hover:text-accent-2">
                          <span aria-hidden className="inline-block rtl:rotate-180">›</span>
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {Object.keys(data.totals).length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-line font-semibold text-ink">
                  {data.columns.map((c, i) => (
                    <td key={c.key} className={`px-2 py-2 ${numeric(c) ? 'text-end' : ''}`}>
                      {c.key in data.totals ? render(c, data.totals[c.key]) : i === 0 ? t('dash.total') : ''}
                    </td>
                  ))}
                  {comparing && (
                    <>
                      <td className="ltr-nums px-2 py-2 text-end text-muted">
                        {previous && compareColumn && compareColumn in previous.totals ? formatMoney(previous.totals[compareColumn]!, 'ILS') : ''}
                      </td>
                      <td className="ltr-nums px-2 py-2 text-end">
                        {previous && compareColumn ? change(data.totals[compareColumn] ?? 0, previous.totals[compareColumn]) : ''}
                      </td>
                    </>
                  )}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
