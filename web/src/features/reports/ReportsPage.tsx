import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  type AccountantPack,
  fetchAccountantPacks,
  fetchAdvanceBase,
  fetchCeilingMeter,
  fetchClientLedgers,
  fetchExpenseReport,
  fetchIncomeReport,
  fetchProfitLoss,
} from '../../api/reports';
import { CeilingMeter } from '../../components/CeilingMeter';
import { DataTable } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { MoneyCell } from '../../components/MoneyCell';
import { useT } from '../../i18n';
import { formatMoney } from '../../lib/money';
import { useMonthLabel } from '../dashboard/charts';
import { apiSend } from '../documents/api';
import { ErrorNote, Loading, useLoad } from '../documents/ui';
import { CatalogReport, linkPath } from './CatalogReport';
import { FILTER_KEYS, REPORT_ENTRIES, REPORT_GROUPS, type ReportEntry, reportEntry } from './catalog';
import { type Period, PeriodControl, todayIsrael, usePeriod } from './period';

/**
 * R21 reports: a left list grouped like SUMIT (Clients, Income, Expenses, Tax). The selected
 * report, its period and any drill-down filters live in the URL (`?report=...&from=...`), so a
 * row link opens the narrower report and the browser's back button returns to the summary.
 */

function DownloadLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={`/api${href}`} className="text-sm font-semibold text-accent-2 hover:underline">
      {children}
    </a>
  );
}

function reportPath(report: string, params: Record<string, string>) {
  return linkPath({ kind: 'report', report, params });
}

function IncomePanel({ from, to }: { from: string; to: string }) {
  const t = useT();
  const { data, error } = useLoad(() => fetchIncomeReport(from, to), [from, to]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {t('reports.totalLabel')} <span className="ltr-nums font-semibold text-ink">{formatMoney(data.totalIlsMinor, 'ILS')}</span>
        </p>
        <div className="flex gap-4">
          <DownloadLink href={`/reports/income.csv?from=${from}&to=${to}`}>{t('reports.downloadCsv')}</DownloadLink>
          <DownloadLink href={`/reports/income.xlsx?from=${from}&to=${to}`}>{t('reports.downloadXlsx')}</DownloadLink>
        </div>
      </div>
      <DataTable
        columns={[
          { key: 'date', header: t('reports.income.colDate'), render: (r) => <span className="ltr-nums">{r.date}</span> },
          {
            key: 'type',
            header: t('reports.income.colType'),
            render: (r) =>
              r.externalSource ? (
                <span>
                  {r.displayNumber ?? r.typeNameEn}
                  <span className="ms-2 rounded bg-surface px-1 text-[10px] uppercase text-muted">{t('dash.imported')}</span>
                </span>
              ) : (
                <Link to={`/income/documents/${r.documentId}`} className="text-accent-2 hover:underline">
                  {r.displayNumber ?? r.typeNameEn}
                </Link>
              ),
          },
          { key: 'client', header: t('reports.income.colClient'), render: (r) => r.clientName ?? '' },
          { key: 'amount', header: t('rcol.amount'), render: (r) => <MoneyCell amountMinor={r.amountMinor} currency={r.currency} />, align: 'right' },
          {
            key: 'ils',
            header: t('reports.income.colAmountIls'),
            render: (r) => <span className="ltr-nums">{r.amountIlsMinor === null ? '' : formatMoney(r.amountIlsMinor, 'ILS')}</span>,
            align: 'right',
          },
        ]}
        rows={data.rows}
        rowKey={(r) => `${r.externalSource ?? 'doc'}:${r.documentId}`}
        searchText={(r) => [r.clientName ?? '', r.typeNameEn, r.displayNumber ?? '']}
        emptyTitle={t('reports.income.empty')}
      />
    </div>
  );
}

function ExpensesPanel({ from, to }: { from: string; to: string }) {
  const t = useT();
  const { data, error } = useLoad(() => fetchExpenseReport(from, to), [from, to]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {t('reports.totalLabel')} <span className="ltr-nums font-semibold text-ink">{formatMoney(data.totalIlsMinor, 'ILS')}</span>
        </p>
        <div className="flex gap-4">
          <DownloadLink href={`/reports/expenses.csv?from=${from}&to=${to}`}>{t('reports.downloadCsv')}</DownloadLink>
          <DownloadLink href={`/reports/expenses.xlsx?from=${from}&to=${to}`}>{t('reports.downloadXlsx')}</DownloadLink>
        </div>
      </div>
      <DataTable
        columns={[
          {
            key: 'date',
            header: t('reports.expenses.colDate'),
            render: (r) => (
              <Link to={`/expenses/${r.expenseId}`} className="ltr-nums text-accent-2 hover:underline">
                {r.date ?? t('rep.open')}
              </Link>
            ),
          },
          { key: 'supplier', header: t('reports.expenses.colSupplier'), render: (r) => r.supplierName ?? '' },
          { key: 'category', header: t('reports.expenses.colCategory'), render: (r) => r.categoryName ?? '' },
          { key: 'amount', header: t('rcol.amount'), render: (r) => <MoneyCell amountMinor={r.amountMinor} currency={r.currency} />, align: 'right' },
          {
            key: 'ils',
            header: t('reports.expenses.colAmountIls'),
            render: (r) => <span className="ltr-nums">{r.amountIlsMinor === null ? '' : formatMoney(r.amountIlsMinor, 'ILS')}</span>,
            align: 'right',
          },
        ]}
        rows={data.rows}
        rowKey={(r) => r.expenseId}
        searchText={(r) => [r.supplierName ?? '', r.categoryName ?? '']}
        emptyTitle={t('reports.expenses.empty')}
      />
    </div>
  );
}

function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

function ProfitLossPanel({ from, to }: { from: string; to: string }) {
  const t = useT();
  const month = useMonthLabel();
  const pl = useLoad(() => fetchProfitLoss(from, to), [from, to]);
  const base = useLoad(() => fetchAdvanceBase(from, to), [from, to]);
  if (pl.error || base.error) return <ErrorNote error={pl.error ?? base.error} />;
  if (!pl.data || !base.data) return <Loading />;
  const { data } = pl;
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">{t('reports.profitLoss.title')}</h3>
          <div className="flex gap-4">
            <DownloadLink href={`/reports/profit-loss.csv?from=${from}&to=${to}`}>{t('reports.downloadCsv')}</DownloadLink>
            <DownloadLink href={`/reports/profit-loss.xlsx?from=${from}&to=${to}`}>{t('reports.downloadXlsx')}</DownloadLink>
          </div>
        </div>
        {data.months.length === 0 ? (
          <EmptyState title={t('reports.profitLoss.empty')} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start text-xs font-semibold uppercase text-muted">
                <th className="py-2 text-start">{t('reports.profitLoss.colMonth')}</th>
                <th className="py-2 text-end">{t('reports.profitLoss.colIncome')}</th>
                <th className="py-2 text-end">{t('reports.profitLoss.colExpenses')}</th>
                <th className="py-2 text-end">{t('reports.profitLoss.colNet')}</th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.month} className="border-t border-line">
                  <td className="py-2">
                    <Link to={reportPath('all-documents', { from: `${m.month}-01`, to: monthEnd(m.month) })} className="text-accent-2 hover:underline">
                      {month(m.month)}
                    </Link>
                  </td>
                  <td className="py-2 text-end ltr-nums">{formatMoney(m.incomeIlsMinor, 'ILS')}</td>
                  <td className="py-2 text-end ltr-nums">
                    <Link to={reportPath('expense-items', { from: `${m.month}-01`, to: monthEnd(m.month) })} className="hover:underline">
                      {formatMoney(m.expensesIlsMinor, 'ILS')}
                    </Link>
                  </td>
                  <td className="py-2 text-end font-semibold ltr-nums">{formatMoney(m.netIlsMinor, 'ILS')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-sm font-semibold text-ink">
          {t('reports.profitLoss.netForPeriod')} <span className="ltr-nums">{formatMoney(data.netIlsMinor, 'ILS')}</span>
        </p>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">{t('reports.profitLoss.advanceBaseTitle')}</h3>
          <DownloadLink href={`/reports/advance-base.csv?from=${from}&to=${to}`}>{t('reports.downloadCsv')}</DownloadLink>
        </div>
        <p className="text-sm text-muted">
          {t('reports.profitLoss.totalReceived')} <span className="ltr-nums">{formatMoney(base.data.totalIlsMinor, 'ILS')}</span>
        </p>
      </div>
    </div>
  );
}

function ClientStatementPanel({ from, to, clientId }: { from: string; to: string; clientId?: string }) {
  const t = useT();
  const { data, error } = useLoad(() => fetchClientLedgers(from, to), [from, to]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const clients = clientId ? data.clients.filter((c) => String(c.clientId) === clientId) : data.clients;
  return (
    <div className="space-y-6">
      <div className="flex justify-end gap-4">
        <DownloadLink href={`/reports/client-ledgers.csv?from=${from}&to=${to}`}>{t('reports.downloadCsv')}</DownloadLink>
        <DownloadLink href={`/reports/client-ledgers.xlsx?from=${from}&to=${to}`}>{t('reports.downloadXlsx')}</DownloadLink>
      </div>
      {clients.length === 0 && <EmptyState title={t('rep.empty')} />}
      {clients.map((c) => (
        <div key={c.clientId}>
          <div className="mb-2 flex items-center justify-between">
            <Link to={`/clients/${c.clientId}`} className="text-sm font-semibold text-accent-2 hover:underline">
              {c.clientName}
            </Link>
            <span className="ltr-nums text-sm font-semibold text-ink">{formatMoney(c.closingIlsMinor, 'ILS')}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase text-muted">
                  <th className="px-2 py-1 text-start">{t('rcol.date')}</th>
                  <th className="px-2 py-1 text-start">{t('rcol.document')}</th>
                  <th className="px-2 py-1 text-start">{t('rep.description')}</th>
                  <th className="px-2 py-1 text-end">{t('rep.debit')}</th>
                  <th className="px-2 py-1 text-end">{t('rep.credit')}</th>
                  <th className="px-2 py-1 text-end">{t('rep.balance')}</th>
                  <th className="px-2 py-1 text-end">{t('rep.balanceIls')}</th>
                </tr>
              </thead>
              <tbody>
                {c.ledger.entries.map((e, i) => (
                  <tr key={`${e.document_id}-${e.kind}-${i}`} className="border-t border-line">
                    <td className="ltr-nums px-2 py-1">{e.date}</td>
                    <td className="px-2 py-1">
                      <Link to={`/income/documents/${e.document_id}`} className="text-accent-2 hover:underline">
                        {`${e.type_name_en} ${e.display_number ?? ''}`.trim()}
                      </Link>
                    </td>
                    <td className="px-2 py-1">{e.description}</td>
                    <td className="px-2 py-1">{e.debit_minor ? <MoneyCell amountMinor={e.debit_minor} currency={e.currency} /> : ''}</td>
                    <td className="px-2 py-1">{e.credit_minor ? <MoneyCell amountMinor={e.credit_minor} currency={e.currency} /> : ''}</td>
                    <td className="px-2 py-1">
                      <MoneyCell amountMinor={e.balance_minor} currency={e.currency} />
                    </td>
                    <td className="ltr-nums px-2 py-1 text-end">{formatMoney(e.balance_ils_minor, 'ILS')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function DocumentsZipPanel({ from, to }: { from: string; to: string }) {
  const t = useT();
  return (
    <div className="max-w-xl space-y-3">
      <p className="text-sm text-muted">{t('rep.documentsZip.description')}</p>
      <a
        href={`/api/reports/documents.zip?from=${from}&to=${to}`}
        className="inline-block rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90"
      >
        {t('rep.documentsZip.download')}
      </a>
    </div>
  );
}

function CeilingPanel() {
  const t = useT();
  const { data, error } = useLoad(() => fetchCeilingMeter(), []);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const { meter } = data;
  if (!meter) return <EmptyState title={t('reports.ceiling.emptyTitle')} description={t('reports.ceiling.emptyDescription')} />;
  return (
    <div className="max-w-md space-y-4">
      <CeilingMeter year={meter.year} currency={meter.currency} limitMinor={meter.limitMinor} currentMinor={meter.currentMinor} />
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted">{t('reports.ceiling.turnoverToDate')}</dt>
        <dd className="ltr-nums text-end text-ink">{formatMoney(meter.turnoverMinor, meter.currency)}</dd>
        <dt className="text-muted">{t('reports.ceiling.openPaymentRequests')}</dt>
        <dd className="ltr-nums text-end text-ink">
          <Link to={reportPath('open-payment-requests', {})} className="hover:underline">
            {formatMoney(meter.openRequestsMinor, meter.currency)}
          </Link>
        </dd>
        <dt className="text-muted">{t('reports.ceiling.legalMode')}</dt>
        <dd className="text-end text-ink">{meter.legalMode === 'patur' ? t('reports.ceiling.legalModePatur') : t('reports.ceiling.legalModeMurshe')}</dd>
      </dl>
    </div>
  );
}

function PackPanel() {
  const t = useT();
  const { data, error, reload } = useLoad(() => fetchAccountantPacks(), []);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  async function runNow() {
    setRunning(true);
    setRunError(null);
    try {
      const period = todayIsrael().slice(0, 7);
      await apiSend('POST', '/reports/packs/run', { period });
      reload();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : t('reports.pack.runError'));
    } finally {
      setRunning(false);
    }
  }

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const packs: AccountantPack[] = data.packs;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{t('reports.pack.description')}</p>
        <button
          type="button"
          disabled={running}
          onClick={() => void runNow()}
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90 disabled:opacity-50"
        >
          {running ? t('reports.pack.running') : t('reports.pack.runNow')}
        </button>
      </div>
      <ErrorNote error={runError} />
      {packs.length === 0 ? (
        <EmptyState title={t('reports.pack.emptyTitle')} description={t('reports.pack.emptyDescription')} />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start text-xs font-semibold uppercase text-muted">
              <th className="py-2 text-start">{t('reports.pack.colPeriod')}</th>
              <th className="py-2 text-end">{t('reports.pack.colIncome')}</th>
              <th className="py-2 text-end">{t('reports.pack.colExpenses')}</th>
              <th className="py-2 text-end">{t('reports.pack.colExpenseFiles')}</th>
              <th className="py-2 text-start">{t('reports.pack.colEmailed')}</th>
            </tr>
          </thead>
          <tbody>
            {packs.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="py-2 ltr-nums">{p.period}</td>
                <td className="py-2 text-end ltr-nums">{formatMoney(p.income_total_ils_minor, 'ILS')}</td>
                <td className="py-2 text-end ltr-nums">{formatMoney(p.expense_total_ils_minor, 'ILS')}</td>
                <td className="py-2 text-end">{p.expense_file_count}</td>
                <td className="py-2">{p.emailed_at ? t('reports.pack.statusSent') : p.email_error ? t('reports.pack.statusFailed') : t('reports.pack.statusNotSent')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const FILTER_LABELS: Record<string, Parameters<ReturnType<typeof useT>>[0]> = {
  clientId: 'rfilter.client',
  clientName: 'rfilter.client',
  type: 'rfilter.type',
  status: 'rfilter.status',
  bucket: 'rfilter.bucket',
  supplierId: 'rfilter.supplier',
  categoryId: 'rfilter.category',
  fixed: 'rfilter.fixed',
  service: 'rfilter.service',
  method: 'rfilter.method',
};

function ReportPanel({ entry, today }: { entry: ReportEntry; today: string }) {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const [stored, setStored] = usePeriod(`report.${entry.id}`, entry.period ?? 'thisYear', undefined, today);
  const [compare, setCompare] = useState(false);
  const urlFrom = params.get('from');
  const urlTo = params.get('to');
  const period: Period = urlFrom && urlTo ? { preset: 'custom', from: urlFrom, to: urlTo } : stored;
  const filters: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v) filters[k] = v;
  }

  const changePeriod = (p: Period) => {
    setStored(p);
    const next = new URLSearchParams(params);
    next.delete('from');
    next.delete('to');
    setParams(next);
  };
  const clearFilter = (k: string) => {
    const next = new URLSearchParams(params);
    next.delete(k);
    setParams(next);
  };

  const { from, to } = period;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-xl text-ink">{t(entry.label)}</h2>
        <div className="flex flex-wrap items-center gap-3">
          {entry.period && <PeriodControl value={period} onChange={changePeriod} today={today} label={t(entry.label)} />}
          {entry.compare && (
            <label className="flex items-center gap-2 text-xs text-ink">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
              {t('rep.compare')}
            </label>
          )}
        </div>
      </div>
      {!entry.period && <p className="text-xs text-muted">{t('rep.asOfToday')}</p>}
      {Object.keys(filters).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(filters).map(([k, v]) => (
            <button key={k} type="button" onClick={() => clearFilter(k)} className="rounded-full border border-line px-3 py-1 text-xs text-ink hover:bg-surface" aria-label={t('rep.clearFilter', { filter: t(FILTER_LABELS[k]!) })}>
              {t(FILTER_LABELS[k]!)}: <span className="ltr-nums">{v}</span> ×
            </button>
          ))}
        </div>
      )}
      {entry.catalog && <CatalogReport id={entry.id} from={from} to={to} filters={filters} compare={compare} compareColumn={entry.compare} />}
      {entry.id === 'income' && <IncomePanel from={from} to={to} />}
      {entry.id === 'expenses' && <ExpensesPanel from={from} to={to} />}
      {entry.id === 'profit-loss' && <ProfitLossPanel from={from} to={to} />}
      {entry.id === 'client-statement' && <ClientStatementPanel from={from} to={to} clientId={filters.clientId} />}
      {entry.id === 'documents-zip' && <DocumentsZipPanel from={from} to={to} />}
      {entry.id === 'ceiling' && <CeilingPanel />}
      {entry.id === 'pack' && <PackPanel />}
    </div>
  );
}

export function ReportsPage({ today = todayIsrael() }: { today?: string }) {
  const t = useT();
  const [params] = useSearchParams();
  const entry = reportEntry(params.get('report'));

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-6xl">
      <h1 id="page-title" className="font-heading text-3xl text-ink">
        {t('reports.title')}
      </h1>
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[14rem_1fr]">
        <nav aria-label={t('rep.listLabel')} className="space-y-4">
          {REPORT_GROUPS.map((g) => (
            <div key={g.id}>
              <h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-muted">{t(g.label)}</h2>
              <ul className="mt-1">
                {REPORT_ENTRIES.filter((r) => r.group === g.id).map((r) => (
                  <li key={r.id}>
                    <Link
                      to={`/reports?report=${r.id}`}
                      aria-current={r.id === entry.id ? 'page' : undefined}
                      className={`block rounded-md px-2 py-1 text-sm ${r.id === entry.id ? 'bg-band font-semibold text-brand' : 'text-ink hover:bg-surface'}`}
                    >
                      {t(r.label)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="min-w-0 rounded-card border border-line bg-canvas p-5 shadow-card">
          <ReportPanel key={entry.id} entry={entry} today={today} />
        </div>
      </div>
    </section>
  );
}
