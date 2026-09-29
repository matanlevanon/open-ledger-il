import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useT } from '../../i18n';
import {
  type Category,
  type Expense,
  type ExpenseStatus,
  type Supplier,
  fileDownloadUrl,
  getExpense,
  listCategories,
  listSuppliers,
  nextExpense,
  setExpenseStatus,
  updateExpense,
} from './api';
import { formatMinor } from './format';

interface FormState {
  categoryId: string;
  documentNumber: string;
  documentDate: string;
  currency: string;
  amount: string;
  vatAmount: string;
  notes: string;
}

function toForm(e: Expense): FormState {
  return {
    categoryId: e.category_id ? String(e.category_id) : '',
    documentNumber: e.document_number ?? '',
    documentDate: e.document_date ?? '',
    currency: e.currency,
    amount: (e.amount_minor / 100).toFixed(2),
    vatAmount: (e.vat_amount_minor / 100).toFixed(2),
    notes: e.notes ?? '',
  };
}

export function ExpenseReviewPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [expense, setExpense] = useState<Expense | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    const [e, cats, sups] = await Promise.all([getExpense(Number(id)), listCategories(), listSuppliers()]);
    setExpense(e);
    setCategories(cats);
    setSuppliers(sups);
    setForm(toForm(e));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function afterDecision() {
    if (!expense) return;
    const next = await nextExpense(expense.id);
    navigate(next ? `/expenses/${next.id}` : '/expenses');
  }

  async function save() {
    if (!expense || !form) return;
    setSaving(true);
    setError(null);
    try {
      await updateExpense(expense.id, {
        categoryId: form.categoryId ? Number(form.categoryId) : null,
        documentNumber: form.documentNumber || null,
        documentDate: form.documentDate || null,
        currency: form.currency,
        amount: form.amount,
        vatAmount: form.vatAmount || null,
        notes: form.notes || null,
      });
    } catch {
      setError(t('expenses.review.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function decide(status: ExpenseStatus) {
    if (!expense) return;
    setSaving(true);
    setError(null);
    try {
      await save();
      if (status === 'returned') {
        if (!returnReason.trim()) {
          setError(t('expenses.review.reasonRequiredError'));
          return;
        }
        await setExpenseStatus(expense.id, 'returned', returnReason.trim());
      } else {
        await setExpenseStatus(expense.id, status);
      }
      await afterDecision();
    } catch {
      setError(t('expenses.review.statusUpdateError'));
    } finally {
      setSaving(false);
    }
  }

  const supplier = suppliers.find((s) => s.id === expense?.supplier_id);

  if (!expense || !form) {
    return (
      <section className="mx-auto max-w-5xl">
        <p className="text-sm text-muted">{t('expenses.loading')}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-5xl">
      <h1 id="page-title" className="font-heading text-3xl text-ink">
        {t('expenses.review.title')}
      </h1>
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-card border border-line bg-surface p-2 shadow-card">
          {expense.file_id ? (
            <iframe title={t('expenses.review.fileIframeTitle')} src={fileDownloadUrl(expense.file_id)} className="h-[340px] w-full rounded md:h-[600px]" />
          ) : (
            <p className="p-10 text-center text-sm text-muted">{t('expenses.review.noFile')}</p>
          )}
        </div>

        <div className="rounded-card border border-line bg-surface p-6 shadow-card">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-muted">{t('expenses.review.supplierLabel')}</dt>
            <dd className="text-ink">
              {supplier?.name ??
                t('expenses.review.supplierIdFallback', {
                  id: expense.supplier_id ?? t('expenses.common.dash'),
                })}
            </dd>
          </dl>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="col-span-2 text-sm text-muted">
              {t('expenses.review.categoryLabel')}
              <select
                className="mt-1 w-full rounded-md border border-line bg-canvas p-2 text-sm"
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                <option value="">{t('expenses.review.noCategoryOption')}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_en}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-muted">
              {t('expenses.review.documentNumberLabel')}
              <input
                className="mt-1 w-full rounded-md border border-line bg-canvas p-2 text-sm"
                value={form.documentNumber}
                onChange={(e) => setForm({ ...form, documentNumber: e.target.value })}
              />
            </label>
            <label className="text-sm text-muted">
              {t('expenses.review.documentDateLabel')}
              <input
                type="date"
                dir="ltr"
                className="mt-1 w-full rounded-md border border-line bg-canvas p-2 text-sm"
                value={form.documentDate}
                onChange={(e) => setForm({ ...form, documentDate: e.target.value })}
              />
            </label>

            <label className="text-sm text-muted">
              {t('expenses.review.currencyLabel')}
              <input
                className="mt-1 w-full rounded-md border border-line bg-canvas p-2 text-sm"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
              />
            </label>
            <label className="text-sm text-muted">
              {t('expenses.review.amountLabel')}
              <input
                className="ltr-nums mt-1 w-full rounded-md border border-line bg-canvas p-2 text-sm"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </label>
            <label className="text-sm text-muted">
              {t('expenses.review.vatAmountLabel')}
              <input
                className="ltr-nums mt-1 w-full rounded-md border border-line bg-canvas p-2 text-sm"
                value={form.vatAmount}
                onChange={(e) => setForm({ ...form, vatAmount: e.target.value })}
              />
            </label>
            {expense.amount_ils_minor !== null && (
              <p className="ltr-nums col-span-2 text-xs text-muted">
                {t('expenses.review.fxRateNote', {
                  amount: formatMinor(expense.amount_ils_minor, 'ILS'),
                  rate: expense.fx_rate ?? '1',
                  source: expense.fx_source ?? t('expenses.review.homeCurrencyFallback'),
                })}
              </p>
            )}

            <label className="col-span-2 text-sm text-muted">
              {t('expenses.review.notesLabel')}
              <textarea
                className="mt-1 w-full rounded-md border border-line bg-canvas p-2 text-sm"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" disabled={saving} onClick={() => decide('filed')} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90 disabled:opacity-50">
              {t('expenses.review.fileButton')}
            </button>
            <button type="button" disabled={saving} onClick={() => decide('not_expense')} className="rounded-full border border-line px-4 py-2 text-sm text-ink hover:bg-canvas disabled:opacity-50">
              {t('expenses.review.notExpenseButton')}
            </button>
            <button type="button" disabled={saving} onClick={() => decide('duplicate')} className="rounded-full border border-line px-4 py-2 text-sm text-ink hover:bg-canvas disabled:opacity-50">
              {t('expenses.review.markDuplicateButton')}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              placeholder={t('expenses.review.returnReasonPlaceholder')}
              className="min-w-[12rem] flex-1 rounded-md border border-line bg-canvas p-2 text-sm"
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
            />
            <button type="button" disabled={saving} onClick={() => decide('returned')} className="rounded-full border border-brand px-4 py-2 text-sm text-brand hover:bg-band disabled:opacity-50">
              {t('expenses.review.returnButton')}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
