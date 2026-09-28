import { useEffect, useState } from 'react';
import { type LayoutEntry, fetchDashboardLayout } from '../../api/dashboard';
import { useToast } from '../../components/Toast';
import { useT } from '../../i18n';
import { apiSend } from '../documents/api';
import { CARD_TITLES } from '../dashboard/DashboardPage';

export async function saveDashboardLayout(cards: LayoutEntry[]): Promise<LayoutEntry[]> {
  return (await apiSend<{ cards: LayoutEntry[] }>('PUT', '/dashboard/layout', { cards })).cards;
}

interface DashboardTabProps {
  /** Injected in tests. */
  load?: () => Promise<LayoutEntry[]>;
  save?: (cards: LayoutEntry[]) => Promise<LayoutEntry[]>;
}

/** R21 task 2k: show or hide each dashboard card and set their order. Stored as a setting, owner only. */
export function DashboardTab({ load = fetchDashboardLayout, save = saveDashboardLayout }: DashboardTabProps) {
  const t = useT();
  const toast = useToast();
  const [cards, setCards] = useState<LayoutEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);

  useEffect(() => {
    load()
      .then(setCards)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : t('settings.dashboard.loadError')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!cards) return <p className="text-sm text-muted">{t('settings.loading')}</p>;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= cards.length || from === to) return;
    const next = [...cards];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setCards(next);
  };

  const submit = async () => {
    setSaving(true);
    try {
      setCards(await save(cards));
      toast.push(t('settings.dashboard.saved'), 'success');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t('settings.dashboard.saveError'), 'danger');
    } finally {
      setSaving(false);
    }
  };

  const small = 'rounded-md border border-line px-2 py-1 text-xs text-ink hover:bg-surface disabled:opacity-40';

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-muted">{t('settings.dashboard.intro')}</p>
      <ol className="divide-y divide-line rounded-md border border-line">
        {cards.map((c, i) => {
          const title = t(CARD_TITLES[c.id]);
          return (
            <li
              key={c.id}
              draggable
              onDragStart={() => setDragging(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragging !== null) move(dragging, i);
                setDragging(null);
              }}
              className={`flex items-center gap-3 px-3 py-2 ${dragging === i ? 'bg-surface' : ''}`}
            >
              <span aria-hidden className="cursor-grab select-none text-muted">⋮⋮</span>
              <label className="flex flex-1 items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={c.visible}
                  onChange={(e) => setCards(cards.map((x) => (x.id === c.id ? { ...x, visible: e.target.checked } : x)))}
                />
                {title}
              </label>
              <button type="button" className={small} disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={t('settings.dashboard.moveUp', { card: title })}>
                ↑
              </button>
              <button type="button" className={small} disabled={i === cards.length - 1} onClick={() => move(i, i + 1)} aria-label={t('settings.dashboard.moveDown', { card: title })}>
                ↓
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        disabled={saving}
        onClick={() => void submit()}
        className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90 disabled:opacity-50"
      >
        {saving ? t('settings.dashboard.saving') : t('settings.dashboard.save')}
      </button>
    </div>
  );
}
