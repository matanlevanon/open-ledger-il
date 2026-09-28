import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n';
import { type Category, createCategory, listCategories, setCategoryActive } from './api';

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function CategoriesPage() {
  const t = useT();
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setCategories(await listCategories(true));
  }

  useEffect(() => {
    load();
  }, []);

  async function add() {
    const key = slugify(name);
    if (!key) return;
    setError(null);
    try {
      await createCategory({ key, nameEn: name.trim() });
      setName('');
      await load();
    } catch {
      setError(t('expenses.categories.addError'));
    }
  }

  async function toggle(category: Category) {
    await setCategoryActive(category.id, category.active !== 1);
    await load();
  }

  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-3xl">
      <Link to="/expenses" className="text-sm text-brand hover:underline">
        {t('expenses.backToExpenses')}
      </Link>
      <h1 id="page-title" className="mt-2 font-heading text-3xl text-ink">
        {t('expenses.categories.title')}
      </h1>

      <div className="mt-6 flex gap-2">
        <input
          placeholder={t('expenses.categories.namePlaceholder')}
          className="flex-1 rounded-md border border-line bg-canvas p-2 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="button" onClick={add} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90">
          {t('expenses.categories.addButton')}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <ul className="mt-6 divide-y divide-line rounded-card border border-line bg-surface shadow-card">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span className={c.active ? 'text-ink' : 'text-muted line-through'}>{c.name_en}</span>
            <button type="button" onClick={() => toggle(c)} className="text-xs text-brand hover:underline">
              {c.active ? t('expenses.categories.deactivate') : t('expenses.categories.activate')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
