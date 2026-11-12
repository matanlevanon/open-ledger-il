import { useEffect, useState } from 'react';
import { apiGet } from '../../api/client';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { apiSend } from '../documents/api';

/**
 * R48 task 6: Settings > Expenses > Categories of this business. Rename, hide, add and reorder.
 * The shared defaults stay as they are for every other business. A category in use cannot be
 * hidden before its expenses move, and the error says how many.
 */
export interface BusinessCategory {
  id: number;
  key: string;
  name_en: string;
  name_he: string | null;
  sort_order: number;
  hidden: number;
  own: number;
}

export const categoriesApi = {
  list: async () => (await apiGet<{ categories: BusinessCategory[] }>('/expenses/categories?all=1')).categories,
  change: async (key: string, input: { nameEn?: string | null; nameHe?: string | null; hidden?: boolean; sortOrder?: number | null }) =>
    (await apiSend<{ categories: BusinessCategory[] }>('PUT', `/expenses/business-categories/${encodeURIComponent(key)}`, input)).categories,
  add: async (nameEn: string) => (await apiSend<{ categories: BusinessCategory[] }>('POST', '/expenses/business-categories', { nameEn })).categories,
};

export function ExpenseCategoriesSection({ api = categoriesApi }: { api?: typeof categoriesApi }) {
  const t = useT();
  const toast = useToast();
  const [list, setList] = useState<BusinessCategory[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [added, setAdded] = useState('');

  useEffect(() => {
    api.list().then(setList).catch(() => setList([]));
  }, [api]);

  const act = async (fn: () => Promise<BusinessCategory[]>) => {
    try {
      setList(await fn());
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.expenses.categoriesError'), 'danger');
    }
  };

  if (!list) return null;
  const ordered = [...list].sort((a, b) => a.sort_order - b.sort_order);
  const move = (i: number, by: number) => {
    const other = ordered[i + by];
    const me = ordered[i];
    if (!other || !me) return;
    void act(async () => {
      await api.change(me.key, { sortOrder: other.sort_order });
      return api.change(other.key, { sortOrder: me.sort_order });
    });
  };

  return (
    <section className="flex flex-col gap-2" data-testid="expense-categories">
      <h2 className="font-heading text-lg text-ink">{t('settings.expenses.categoriesTitle')}</h2>
      <p className="text-xs text-muted">{t('settings.expenses.categoriesHint')}</p>
      <ul className="flex flex-col divide-y divide-line">
        {ordered.map((c, i) => (
          <li key={c.key} className={`flex flex-wrap items-center gap-2 py-1 text-sm ${c.hidden ? 'opacity-60' : ''}`}>
            <input
              aria-label={t('settings.expenses.categoryName')}
              value={names[c.key] ?? c.name_en}
              onChange={(e) => setNames({ ...names, [c.key]: e.target.value })}
              onBlur={() => {
                const next = names[c.key];
                if (next !== undefined && next.trim() && next !== c.name_en) void act(() => api.change(c.key, { nameEn: next }));
              }}
              className="min-w-0 flex-1 rounded-md border border-line px-2 py-1 text-sm text-ink"
            />
            <button type="button" className="text-xs text-muted" aria-label={t('settings.expenses.categoryUp')} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button type="button" className="text-xs text-muted" aria-label={t('settings.expenses.categoryDown')} onClick={() => move(i, 1)}>
              ↓
            </button>
            <button type="button" className="text-xs text-accent-2" onClick={() => void act(() => api.change(c.key, { hidden: !c.hidden }))}>
              {c.hidden ? t('settings.expenses.categoryShow') : t('settings.expenses.categoryHide')}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!added.trim()) return;
          void act(async () => {
            const next = await api.add(added.trim());
            setAdded('');
            return next;
          });
        }}
      >
        <input
          aria-label={t('settings.expenses.categoryNew')}
          placeholder={t('settings.expenses.categoryNew')}
          value={added}
          onChange={(e) => setAdded(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-line px-2 py-1 text-sm text-ink"
        />
        <button type="submit" className="rounded-full border border-line px-4 py-1 text-sm">
          {t('settings.expenses.categoryAdd')}
        </button>
      </form>
    </section>
  );
}
