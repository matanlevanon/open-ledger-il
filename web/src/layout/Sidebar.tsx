import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import type { Role } from '../api/client';
import { type Locale, usePreferences } from '../app/preferences';
import { type Client, type DocType, clientsApi, docsApi } from '../features/documents/api';
import { clientName, newDocumentPath, offeredDocumentTypes } from '../features/documents/format';
import { useT } from '../i18n';
import { CREATE_NEW_LABEL_KEYS, NAV, canSee } from './nav';

interface SidebarProps {
  role: Role | undefined;
  features: string[];
  /** Scopes the remembered Active/Not active expand state to this user (R18 task 5). */
  email?: string;
  onNavigate?: () => void;
}

const itemClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 text-sm ${isActive ? 'bg-band font-semibold text-brand' : 'text-ink hover:bg-surface'}`;

function groupStorageKey(email: string | undefined, group: 'active' | 'notActive'): string {
  return `open-ledger-il-sidebar-clients-${group}-open:${email ?? 'anon'}`;
}

/** Local, per-browser memory of whether a client group is expanded (R18 task 5). Never throws in private browsing. */
function readGroupOpen(email: string | undefined, group: 'active' | 'notActive', fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(groupStorageKey(email, group));
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writeGroupOpen(email: string | undefined, group: 'active' | 'notActive', open: boolean): void {
  try {
    localStorage.setItem(groupStorageKey(email, group), open ? '1' : '0');
  } catch {
    // Private browsing or storage disabled: the toggle still works this session, just not remembered.
  }
}

interface ClientGroupProps {
  title: string;
  clients: Client[];
  open: boolean;
  onToggle: () => void;
  locale: Locale;
  onNavigate?: () => void;
}

function ClientGroup({ title, clients, open, onToggle, locale, onNavigate }: ClientGroupProps) {
  const t = useT();
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted hover:bg-surface"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>
          {title} ({clients.length})
        </span>
        <span aria-hidden="true">{open ? '▾' : locale === 'he' ? '◂' : '▸'}</span>
      </button>
      {open && (
        <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto ps-2">
          {clients.length === 0 && <li className="px-3 py-1 text-xs text-muted">{t('sidebar.clients.noMatches')}</li>}
          {clients.map((c) => (
            <li key={c.id}>
              <NavLink to={`/clients/${c.id}`} className={itemClass} onClick={onNavigate}>
                <span className="block truncate text-sm">{clientName(c, locale)}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ClientsNavItemProps {
  onNavigate?: () => void;
  email?: string;
}

/** The expandable Clients menu item (R18 task 5): opens the list page and, in place, two collapsible groups. */
function ClientsNavItem({ onNavigate, email }: ClientsNavItemProps) {
  const t = useT();
  const location = useLocation();
  const { locale } = usePreferences();
  const expanded = location.pathname === '/clients' || location.pathname.startsWith('/clients/');
  const [clients, setClients] = useState<Client[] | null>(null);
  const [filter, setFilter] = useState('');
  const [activeOpen, setActiveOpen] = useState(() => readGroupOpen(email, 'active', true));
  const [notActiveOpen, setNotActiveOpen] = useState(() => readGroupOpen(email, 'notActive', false));

  useEffect(() => {
    if (!expanded || clients !== null) return;
    let live = true;
    clientsApi
      .list({ active: 'all' })
      .then((res) => live && setClients(res.clients))
      .catch(() => live && setClients([]));
    return () => {
      live = false;
    };
  }, [expanded, clients]);

  const { active, notActive } = useMemo(() => {
    const all = clients ?? [];
    const needle = filter.trim().toLowerCase();
    const matches = (c: Client) =>
      needle === '' || c.name_en.toLowerCase().includes(needle) || (c.name_he ?? '').toLowerCase().includes(needle);
    const sorted = (list: Client[]) => [...list].sort((a, b) => clientName(a, locale).localeCompare(clientName(b, locale), locale));
    return {
      active: sorted(all.filter((c) => c.active === 1 && matches(c))),
      notActive: sorted(all.filter((c) => c.active !== 1 && matches(c))),
    };
  }, [clients, filter, locale]);

  return (
    <li>
      <NavLink to="/clients" end className={itemClass} onClick={onNavigate}>
        {t('nav.clients')}
      </NavLink>
      {expanded && (
        <div className="mt-1 space-y-2 ps-2">
          <input
            type="search"
            aria-label={t('sidebar.clients.filterAriaLabel')}
            placeholder={t('sidebar.clients.filterPlaceholder')}
            className="w-full rounded-md border border-line bg-canvas px-2 py-1 text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <ClientGroup
            title={t('sidebar.clients.active')}
            clients={active}
            open={activeOpen}
            onToggle={() => {
              const next = !activeOpen;
              setActiveOpen(next);
              writeGroupOpen(email, 'active', next);
            }}
            locale={locale}
            onNavigate={onNavigate}
          />
          <ClientGroup
            title={t('sidebar.clients.notActive')}
            clients={notActive}
            open={notActiveOpen}
            onToggle={() => {
              const next = !notActiveOpen;
              setNotActiveOpen(next);
              writeGroupOpen(email, 'notActive', next);
            }}
            locale={locale}
            onNavigate={onNavigate}
          />
        </div>
      )}
    </li>
  );
}

export function Sidebar({ role, features, email, onNavigate }: SidebarProps) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [types, setTypes] = useState<DocType[] | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menuOpen]);

  /**
   * R19 task 7: "Create new" follows the current legal mode, the same as the client page's "New
   * document" dropdown, so Invoice (305) and Invoice/Receipt (320) join it the moment the switch
   * enables them — no separate static list to fall out of sync.
   */
  useEffect(() => {
    if (role === 'accountant' || types !== null) return;
    let live = true;
    docsApi
      .types()
      .then((res) => live && setTypes(res.types))
      .catch(() => live && setTypes([]));
    return () => {
      live = false;
    };
  }, [role, types]);
  const createNewItems = offeredDocumentTypes(types ?? []);

  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-4 overflow-y-auto border-e border-line bg-canvas p-4">
      <Link to="/" className="px-3 font-heading text-xl text-brand" onClick={onNavigate}>
        {t('app.name')}
      </Link>

      {role !== 'accountant' && (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            className="w-full rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {t('nav.createNew')}
          </button>
          {menuOpen && (
            <ul role="menu" className="absolute start-0 end-0 z-20 mt-2 rounded-card border border-line bg-canvas p-1 shadow-card">
              {createNewItems.map((ty) => (
                <li key={ty.code} role="none">
                  <Link
                    role="menuitem"
                    to={newDocumentPath(ty.code)}
                    className="block rounded-md px-3 py-2 text-sm hover:bg-surface"
                    onClick={() => {
                      setMenuOpen(false);
                      onNavigate?.();
                    }}
                  >
                    {CREATE_NEW_LABEL_KEYS[ty.code] ? t(CREATE_NEW_LABEL_KEYS[ty.code]!) : ty.name_en}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-1">
        {NAV.filter((section) => canSee(section, role, features) || section.children?.some((c) => canSee(c, role, features))).map((section) =>
          section.path === '/clients' ? (
            <ClientsNavItem key={section.path} onNavigate={onNavigate} email={email} />
          ) : (
            <li key={section.path}>
              {section.children ? (
                <>
                  <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">{t(section.label)}</p>
                  <ul className="ms-3 flex flex-col gap-1 border-s border-line ps-2">
                    {section.children
                      .filter((c) => canSee(c, role, features))
                      .map((child) => (
                        <li key={child.path}>
                          <NavLink to={child.path} className={itemClass} onClick={onNavigate}>
                            {t(child.label)}
                          </NavLink>
                        </li>
                      ))}
                  </ul>
                </>
              ) : (
                <NavLink to={section.path} end={section.path === '/'} className={itemClass} onClick={onNavigate}>
                  {t(section.label)}
                </NavLink>
              )}
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
