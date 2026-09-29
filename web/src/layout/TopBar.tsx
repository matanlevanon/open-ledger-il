import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Me } from '../api/client';
import { usePreferences } from '../app/preferences';
import { useT } from '../i18n';
import defaultLogo from '../brand/default-logo.svg';
import defaultLogoDark from '../brand/default-logo-dark.svg';

/** The logo uploaded in Settings > Business. A 404 (none uploaded) or 403 (not the owner) shows the default. */
const UPLOADED_LOGO_URL = '/api/ops/business/logo';

interface TopBarProps {
  me: Me | null;
  error: string | null;
  onMenu: () => void;
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path
        strokeLinecap="round"
        d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M20.5 14.5a8.5 8.5 0 1 1-9-13 7 7 0 0 0 9 13Z" />
    </svg>
  );
}

export function TopBar({ me, error, onMenu }: TopBarProps) {
  const t = useT();
  const { theme, setTheme, locale, setLocale } = usePreferences();
  const [uploaded, setUploaded] = useState(true);

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-band px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:static md:gap-4 md:px-8 md:py-3">
      <button
        type="button"
        className="grid h-11 w-11 place-items-center rounded-md text-sm text-ink hover:bg-canvas md:hidden"
        aria-label={t('topbar.openMenu')}
        onClick={onMenu}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <Link to="/" className="flex items-center">
        <img
          src={uploaded ? UPLOADED_LOGO_URL : theme === 'light' ? defaultLogo : defaultLogoDark}
          alt={t('app.name')}
          className="h-7 w-auto"
          onError={() => setUploaded(false)}
        />
      </Link>

      <div className="ms-auto flex items-center gap-1 text-sm md:gap-3">
        <button
          type="button"
          className="grid h-11 w-11 place-items-center rounded-md text-ink hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 md:h-auto md:w-auto md:p-1.5"
          aria-label={theme === 'dark' ? t('topbar.switchToLightTheme') : t('topbar.switchToDarkTheme')}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>

        <button
          type="button"
          className="grid h-11 min-w-[2.75rem] place-items-center rounded-md px-2 text-sm font-semibold text-ink hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-2 md:h-auto md:min-w-0 md:py-1 md:text-xs"
          aria-label={locale === 'he' ? t('topbar.switchToEnglish') : t('topbar.switchToHebrew')}
          onClick={() => setLocale(locale === 'he' ? 'en' : 'he')}
        >
          {locale === 'he' ? 'EN' : 'עב'}
        </button>

        {me ? (
          <>
            <span className="hidden text-ink sm:inline">{me.name ?? me.email}</span>
            <span className="hidden rounded-full bg-canvas px-2 py-0.5 text-xs font-semibold capitalize text-brand sm:inline" data-testid="role-chip">
              {me.role}
            </span>
          </>
        ) : (
          <span className="text-muted">{error ?? t('topbar.signingIn')}</span>
        )}

        {/* Cloudflare Access ends the session at its own logout path, then shows its sign-in page again. */}
        <a
          href="/cdn-cgi/access/logout"
          className="rounded-md px-2 py-1 text-sm text-ink hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-2"
        >
          {t('topbar.signOut')}
        </a>
      </div>
    </header>
  );
}
