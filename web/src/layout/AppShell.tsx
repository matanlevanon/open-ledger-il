import { type ReactNode, useEffect, useRef, useState } from 'react';
import { IssuingProvider } from '../app/issuing';
import { useLocation } from 'react-router-dom';
import { MOCK_MODE, type Me, fetchMe } from '../api/client';
import { SetupScreen } from '../features/settings/SetupScreen';
import { usePreferences } from '../app/preferences';
import { useT } from '../i18n';
import { BottomNav } from './BottomNav';
import { Sidebar } from './Sidebar';
import { useStackTables } from './stackTables';
import { TopBar } from './TopBar';

interface AppShellProps {
  children: ReactNode;
  /** Injected in tests. Defaults to GET /api/me. */
  loadMe?: () => Promise<Me>;
}

export function AppShell({ children, loadMe = fetchMe }: AppShellProps) {
  const t = useT();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [issuing, setIssuing] = useState(true);
  const { syncFromServer } = usePreferences();
  const mainRef = useRef<HTMLElement>(null);
  useStackTables(mainRef);

  useEffect(() => {
    let live = true;
    loadMe()
      .then((user) => live && setMe(user))
      .catch(() => live && setError('Not signed in'));
    return () => {
      live = false;
    };
  }, [loadMe]);

  // The signed-in user's saved theme/locale (a different device's choice, for example) wins
  // once it loads, over whatever local storage or the system preference guessed (R16 tasks 15/16).
  useEffect(() => {
    if (me) syncFromServer(me.theme, me.locale);
    if (me) setIssuing(me.issuing !== false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  // First-run setup (R22): the owner fills in Settings > Business before anything else. A failed
  // check (offline, mock mode, tests) never blocks the app; the Worker enforces the rule anyway.
  const [missing, setMissing] = useState<string[]>([]);
  const location = useLocation();
  const checkSetup = () => {
    if (MOCK_MODE || me?.role !== 'owner') return;
    fetch('/api/ops/business/setup', { headers: { Accept: 'application/json' } })
      .then((res) => (res.ok ? (res.json() as Promise<{ missing: string[] }>) : { missing: [] }))
      .then((body) => setMissing(Array.isArray(body.missing) ? body.missing : []))
      .catch(() => setMissing([]));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(checkSetup, [me]);
  const showSetup = missing.length > 0 && !/^\/(settings|about)(\/|$)/.test(location.pathname);

  const sidebar = <Sidebar role={me?.role} features={me?.features ?? []} email={me?.email} issuing={issuing} onNavigate={() => setDrawerOpen(false)} />;

  return (
    <IssuingProvider value={{ issuing, setIssuing }}>
    <div className="flex h-full min-w-0">
      <aside className="hidden w-[var(--sidebar-width)] shrink-0 md:block">{sidebar}</aside>
      {drawerOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <button type="button" aria-label={t('sidebar.closeMenu')} className="absolute inset-0 bg-ink/30" onClick={() => setDrawerOpen(false)} />
          <aside className="relative h-full w-[var(--sidebar-width)] max-w-[85vw]">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar me={me} error={error} onMenu={() => setDrawerOpen(true)} />
        {/* Bottom padding on phones keeps the last row clear of the tab bar. */}
        <main ref={mainRef} className="flex-1 overflow-y-auto px-4 pb-28 pt-5 md:px-8 md:py-6">
          {showSetup ? <SetupScreen missing={missing} onSaved={checkSetup} /> : children}
        </main>
      </div>
      <BottomNav role={me?.role} features={me?.features ?? []} onMore={() => setDrawerOpen(true)} />
    </div>
    </IssuingProvider>
  );
}
