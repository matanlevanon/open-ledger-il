import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n';
import { type Supplier, createSupplier, listSuppliers } from './api';

export function SuppliersPage() {
  const t = useT();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [name, setName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setSuppliers(await listSuppliers());
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    if (!name.trim()) return;
    setError(null);
    try {
      await createSupplier({ name: name.trim(), taxId: taxId.trim() || null });
      setName('');
      setTaxId('');
      await load();
    } catch {
      setError(t('expenses.suppliers.addError'));
    }
  }

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-3xl">
      <Link to="/expenses" className="text-sm text-brand hover:underline">
        {t('expenses.backToExpenses')}
      </Link>
      <h1 id="page-title" className="mt-2 font-heading text-3xl text-ink">
        {t('expenses.suppliers.title')}
      </h1>

      <div className="mt-6 flex flex-wrap gap-2">
        <input
          placeholder={t('expenses.suppliers.namePlaceholder')}
          className="flex-1 rounded-md border border-line bg-canvas p-2 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          placeholder={t('expenses.suppliers.taxIdPlaceholder')}
          className="w-48 rounded-md border border-line bg-canvas p-2 text-sm"
          value={taxId}
          onChange={(e) => setTaxId(e.target.value)}
        />
        <button type="button" onClick={add} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90">
          {t('expenses.suppliers.addButton')}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <ul className="mt-6 divide-y divide-line rounded-card border border-line bg-surface shadow-card">
        {suppliers.map((s) => (
          <li key={s.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="text-ink">{s.name}</span>
            <span className="ltr-nums text-muted">{s.tax_id ?? t('expenses.common.dash')}</span>
          </li>
        ))}
        {suppliers.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">{t('expenses.suppliers.empty')}</li>}
      </ul>
    </section>
  );
}
