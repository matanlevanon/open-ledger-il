import { createContext, type ReactNode, useContext, useState } from 'react';

/**
 * Theme (R16 task 15) and interface-language (R16 task 16) preference, applied before first
 * paint by the inline script in index.html (so there is no flash), then kept in sync here.
 * Local storage is the fast, pre-sign-in default; the signed-in user's saved server preference
 * (`GET /api/me`'s `theme`/`locale`) is the cross-device source of truth once it loads, and wins
 * over whatever local storage or the system preference guessed.
 */

export type Theme = 'light' | 'dark';
export type Locale = 'en' | 'he';

const THEME_KEY = 'open-ledger-il-theme';
const LOCALE_KEY = 'open-ledger-il-locale';

export function systemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readInitialTheme(): Theme {
  const attr = document.documentElement.dataset.theme;
  return attr === 'dark' || attr === 'light' ? attr : systemTheme();
}

function readInitialLocale(): Locale {
  return document.documentElement.lang === 'he' ? 'he' : 'en';
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

function applyLocale(locale: Locale) {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr';
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing or storage disabled: theme/locale still work for this tab, just not remembered.
  }
}

interface PreferencesContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Called once GET /api/me resolves: applies the signed-in user's saved choice (a different
   * device's pick, for example) without re-persisting what the server itself just said. */
  syncFromServer: (theme: Theme | null | undefined, locale: Locale | null | undefined) => void;
}

/**
 * Default value (not null): components deep in the tree — DataTable, Dialog, and anything else
 * that renders text through `useT()` — are unit-tested standalone, without a PreferencesProvider
 * wrapping them, throughout this codebase. Falling back to the system theme and English rather
 * than throwing keeps every one of those tests working unchanged, at the cost of the fallback's
 * setters being no-ops (there is no provider state for them to update).
 */
const defaultPreferences: PreferencesContextValue = {
  theme: 'light',
  setTheme: () => undefined,
  locale: 'en',
  setLocale: () => undefined,
  syncFromServer: () => undefined,
};

const PreferencesContext = createContext<PreferencesContextValue>(defaultPreferences);

export interface PreferencesProviderProps {
  children: ReactNode;
  /** Persists a change to PATCH /api/me/preferences. Defaults to the real endpoint; tests override it. */
  persist?: (patch: { theme?: Theme; locale?: Locale }) => void;
}

const defaultPersist = (patch: { theme?: Theme; locale?: Locale }) => {
  void fetch('/api/me/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => undefined);
};

export function PreferencesProvider({ children, persist = defaultPersist }: PreferencesProviderProps) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  const applyThemeLocally = (next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    storageSet(THEME_KEY, next);
  };

  const applyLocaleLocally = (next: Locale) => {
    setLocaleState(next);
    applyLocale(next);
    storageSet(LOCALE_KEY, next);
  };

  const setTheme = (next: Theme) => {
    applyThemeLocally(next);
    persist({ theme: next });
  };

  const setLocale = (next: Locale) => {
    applyLocaleLocally(next);
    persist({ locale: next });
  };

  const syncFromServer = (serverTheme: Theme | null | undefined, serverLocale: Locale | null | undefined) => {
    if (serverTheme) applyThemeLocally(serverTheme);
    if (serverLocale) applyLocaleLocally(serverLocale);
  };

  return (
    <PreferencesContext.Provider value={{ theme, setTheme, locale, setLocale, syncFromServer }}>{children}</PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  return useContext(PreferencesContext);
}
