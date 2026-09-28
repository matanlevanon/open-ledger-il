import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { type MessageKey, useT } from '../../i18n';
import { type Expense, type ExpenseStatus, type ImportSummary, importMonth, lastMonth, listExpenses, uploadExpense } from './api';
import { ImportSummaryView } from './ImportSummaryView';
import { STATUS_LABEL_KEYS, formatMinor } from './format';

const TABS: { label: MessageKey; value: ExpenseStatus | 'all' }[] = [
  { label: 'expenses.status.new', value: 'new' },
  { label: 'expenses.status.filed', value: 'filed' },
  { label: 'expenses.status.notExpense', value: 'not_expense' },
  { label: 'expenses.status.duplicate', value: 'duplicate' },
  { label: 'expenses.status.returned', value: 'returned' },
  { label: 'expenses.list.tabAll', value: 'all' },
];

const statusChipClass: Record<string, string> = {
  new: 'bg-band text-brand',
  filed: 'bg-surface text-ink',
  not_expense: 'bg-surface text-muted',
  duplicate: 'bg-canvas text-muted border border-line',
  returned: 'bg-canvas text-brand border border-brand',
};

export function ExpensesListPage() {
  const t = useT();
  const [tab, setTab] = useState<ExpenseStatus | 'all'>('new');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [month, setMonth] = useState(lastMonth());
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setExpenses(await listExpenses(tab === 'all' ? {} : { status: tab }));
    } catch {
      setError(t('expenses.list.loadError'));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  async function onUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) await uploadExpense(file);
      await load();
    } catch {
      setError(t('expenses.list.uploadError'));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function onImport() {
    setImporting(true);
    setError(null);
    try {
      setSummary(await importMonth(month));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('expenses.import.error'));
    } finally {
      setImporting(false);
    }
  }

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="page-title" className="font-heading text-3xl text-ink">
          {t('expenses.list.title')}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/expenses/suppliers" className="text-sm text-brand hover:underline">
            {t('expenses.list.suppliersLink')}
          </Link>
          <Link to="/expenses/categories" className="text-sm text-brand hover:underline">
            {t('expenses.list.categoriesLink')}
          </Link>
          <label className="sr-only" htmlFor="import-month">
            {t('expenses.import.monthLabel')}
          </label>
          <input
            id="import-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="ltr-nums rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={importing || !/^\d{4}-\d{2}$/.test(month)}
            onClick={onImport}
            className="rounded-full border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-band disabled:opacity-60"
          >
            {importing ? t('expenses.import.running') : t('expenses.import.button')}
          </button>
          <label className="cursor-pointer rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90">
            {uploading ? t('expenses.list.uploading') : t('expenses.list.uploadButton')}
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="application/pdf,image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => onUpload(e.target.files)}
            />
          </label>
        </div>
      </div>

      <div className="mt-6 flex gap-1 border-b border-line" role="tablist" aria-label={t('expenses.list.statusTablistLabel')}>
        {TABS.map((tabItem) => (
          <button
            key={tabItem.value}
            type="button"
            role="tab"
            aria-selected={tab === tabItem.value}
            onClick={() => setTab(tabItem.value)}
            className={`rounded-t-md px-3 py-2 text-sm ${tab === tabItem.value ? 'border-b-2 border-brand font-semibold text-brand' : 'text-muted hover:text-ink'}`}
          >
            {t(tabItem.label)}
          </button>
        ))}
      </div>

      {summary && (
        <div className="mt-4">
          <ImportSummaryView summary={summary} />
        </div>
      )}

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      <div className="mt-4 overflow-hidden rounded-card border border-line bg-surface shadow-card">
        {loading ? (
          <p className="p-6 text-sm text-muted">{t('expenses.loading')}</p>
        ) : expenses.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted">{t('expenses.list.empty')}</p>
        ) : (
          <table className="w-full text-start text-sm">
            <thead className="bg-band text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2">{t('expenses.list.colDate')}</th>
                <th className="px-4 py-2">{t('expenses.list.colSupplier')}</th>
                <th className="px-4 py-2">{t('expenses.list.colDocument')}</th>
                <th className="px-4 py-2">{t('expenses.list.colCategory')}</th>
                <th className="px-4 py-2">{t('expenses.list.colAmount')}</th>
                <th className="px-4 py-2">{t('expenses.list.colAmountIls')}</th>
                <th className="px-4 py-2">{t('expenses.list.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-t border-line hover:bg-canvas">
                  <td className="px-4 py-2">
                    <Link to={`/expenses/${e.id}`} className="ltr-nums block text-ink hover:text-brand">
                      {e.document_date ?? t('expenses.common.dash')}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <Link to={`/expenses/${e.id}`}>
                      {e.supplier_name || (e.supplier_id ? t('expenses.list.supplierFallback', { id: e.supplier_id }) : t('expenses.common.dash'))}
                    </Link>
                    {e.supplier_tax_id && <span className="ltr-nums block text-xs text-muted">{e.supplier_tax_id}</span>}
                  </td>
                  <td className="px-4 py-2">{e.document_number ?? t('expenses.common.dash')}</td>
                  <td className="px-4 py-2">
                    {e.category_name ?? t('expenses.common.dash')}
                    {e.document_type && <span className="block text-xs text-muted">{e.document_type}</span>}
                  </td>
                  <td className="ltr-nums px-4 py-2">{formatMinor(e.amount_minor, e.currency)}</td>
                  <td className="ltr-nums px-4 py-2">{e.amount_ils_minor !== null && e.amount_ils_minor !== undefined ? formatMinor(e.amount_ils_minor, 'ILS') : t('expenses.common.dash')}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusChipClass[e.status] ?? ''}`}>
                      {t(STATUS_LABEL_KEYS[e.status] ?? 'expenses.status.new')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
