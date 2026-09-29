import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { Role } from '../api/client';
import { type MessageKey, useT } from '../i18n';

/**
 * Phone-only tab bar at the bottom of the screen: the four places used most, a New button in the
 * middle, and More, which opens the full sidebar. Hidden from md up, where the sidebar shows.
 */
interface BottomNavProps {
  role?: Role;
  features: string[];
  onMore: () => void;
}

interface Item {
  to: string;
  label: MessageKey;
  feature?: string;
  icon: ReactNode;
  end?: boolean;
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const ITEMS: Item[] = [
  {
    to: '/',
    end: true,
    label: 'nav.dashboard',
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden {...stroke}>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5.5 10v9.5h13V10" />
      </svg>
    ),
  },
  {
    to: '/income/documents',
    label: 'bottomNav.documents',
    feature: 'income_documents',
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden {...stroke}>
        <path d="M7 3h7l4 4v14H7z" />
        <path d="M14 3v4h4M10 12h5M10 16h5" />
      </svg>
    ),
  },
  {
    to: '/clients',
    label: 'nav.clients',
    feature: 'clients',
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden {...stroke}>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-2.6-1.6-4.8-4-5.6" />
      </svg>
    ),
  },
  {
    to: '/expenses',
    label: 'nav.expenses',
    feature: 'expenses',
    icon: (
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden {...stroke}>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18M7 15h4" />
      </svg>
    ),
  },
];

const itemClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-[3.5rem] flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[0.72rem] font-semibold leading-tight ${
    isActive ? 'text-brand' : 'text-muted'
  }`;

export function BottomNav({ role, features, onMore }: BottomNavProps) {
  const t = useT();
  const can = (feature?: string) => role === 'owner' || !feature || features.includes(feature);
  const visible = ITEMS.filter((i) => can(i.feature));
  const [first, second, ...rest] = visible;
  const showNew = role === 'owner';

  const link = (i: Item) => (
    <NavLink key={i.to} to={i.to} end={i.end} className={itemClass}>
      {i.icon}
      <span className="max-w-full truncate">{t(i.label)}</span>
    </NavLink>
  );

  return (
    <nav
      aria-label={t('bottomNav.label')}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-band/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around gap-1 px-2 py-1">
        {first && link(first)}
        {second && link(second)}
        {showNew && (
          <NavLink to="/income/documents/new" aria-label={t('nav.createNew')} className="flex min-h-[3.5rem] flex-col items-center justify-center px-1">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-brand text-brand-ink shadow-card">
              <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden {...stroke} strokeWidth={2.5}>
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
          </NavLink>
        )}
        {rest.map(link)}
        <button type="button" onClick={onMore} className={itemClass({ isActive: false })}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden {...stroke}>
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span>{t('bottomNav.more')}</span>
        </button>
      </div>
    </nav>
  );
}
