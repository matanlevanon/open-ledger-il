import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type BusinessList, fetchBusinesses } from '../api/businesses';
import { MOCK_MODE } from '../api/client';
import { switchBusiness } from '../app/business';
import { type MessageKey, useT } from '../i18n';
import { usePreferences } from '../app/preferences';

/** R48: the search box shows above this many businesses. */
export const SEARCH_ABOVE = 8;

interface Props {
  /** Injected in tests. */
  load?: () => Promise<BusinessList>;
  /** Injected in tests. Default: set the cookie and reload. */
  onSwitch?: (id: number) => void;
}

/**
 * R24 B4: the business switcher in the top bar. It lists every business the person may open. An
 * owner always sees it, with Add a business last, so opening a company is reachable from any
 * screen. Anyone else with one business never sees it.
 */
export function BusinessSwitcher({ load = fetchBusinesses, onSwitch = switchBusiness }: Props) {
  const t = useT();
  const { locale } = usePreferences();
  const navigate = useNavigate();
  const [data, setData] = useState<BusinessList | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (MOCK_MODE && load === fetchBusinesses) return;
    load()
      .then(setData)
      .catch(() => setData(null));
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!data) return null;
  const canAdd = data.addableTypes.length > 0;
  if (data.businesses.length < 2 && !canAdd) return null;
  const name = (b: BusinessList['businesses'][number]) => (locale === 'he' ? b.nameHe || b.nameEn : b.nameEn || b.nameHe) || `#${b.id}`;
  const current = data.businesses.find((b) => b.id === data.current);
  // R48: a firm with many clients. Above 8 businesses the list is sorted by name with the tax id
  // under each name, and a search box filters it. Up to 8, the list stays as it was.
  const many = data.businesses.length > SEARCH_ABOVE;
  const q = query.trim().toLowerCase();
  const shown = many
    ? [...data.businesses]
        .sort((a, b) => name(a).localeCompare(name(b), locale === 'he' ? 'he' : 'en'))
        .filter((b) => !q || `${b.nameEn} ${b.nameHe} ${b.taxId ?? ''}`.toLowerCase().includes(q))
    : data.businesses;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('businesses.switcher.label')}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[11rem] items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-ink hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
      >
        <span className="truncate" data-testid="current-business">
          {current ? name(current) : t('businesses.switcher.label')}
        </span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div role="menu" className="absolute end-0 z-30 mt-1 max-h-[70vh] w-64 overflow-y-auto rounded-md border border-line bg-canvas p-1 shadow-card">
          {many && (
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('businesses.switcher.search')}
              aria-label={t('businesses.switcher.search')}
              className="mb-1 w-full rounded border border-line bg-canvas px-2 py-1 text-sm text-ink"
            />
          )}
          {shown.map((b) => (
            <button
              key={b.id}
              role="menuitemradio"
              aria-checked={b.id === data.current}
              type="button"
              onClick={() => {
                setOpen(false);
                if (b.id !== data.current) onSwitch(b.id);
              }}
              className={`flex w-full flex-col items-start rounded px-3 py-2 text-start text-sm hover:bg-surface ${b.id === data.current ? 'font-semibold text-brand' : 'text-ink'}`}
            >
              <span>{name(b)}</span>
              {many && b.taxId && <span className="text-xs text-muted" dir="ltr">{b.taxId}</span>}
              <span className="text-xs text-muted">{t(`businessType.${b.entityType}` as MessageKey)}</span>
            </button>
          ))}
          {canAdd && (
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/settings?tab=businesses&add=1');
              }}
              className="mt-1 w-full rounded border-t border-line px-3 py-2 text-start text-sm font-semibold text-accent-2 hover:bg-surface"
            >
              {t('businesses.switcher.add')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
