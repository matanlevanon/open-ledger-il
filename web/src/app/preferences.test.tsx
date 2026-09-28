import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesProvider, systemTheme, usePreferences } from './preferences';

function setMatchMediaDark(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark') && matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
  setMatchMediaDark(false);
});

describe('systemTheme', () => {
  it('reads dark from the system color-scheme preference', () => {
    setMatchMediaDark(true);
    expect(systemTheme()).toBe('dark');
  });

  it('defaults to light when the system has no dark preference', () => {
    setMatchMediaDark(false);
    expect(systemTheme()).toBe('light');
  });
});

describe('usePreferences outside a provider', () => {
  it('falls back to light/English instead of throwing', () => {
    const { result } = renderHook(() => usePreferences());
    expect(result.current.theme).toBe('light');
    expect(result.current.locale).toBe('en');
  });
});

describe('PreferencesProvider', () => {
  it('reads the initial theme and locale already applied to <html> by the pre-paint script', () => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.lang = 'he';
    const { result } = renderHook(() => usePreferences(), { wrapper: ({ children }) => <PreferencesProvider>{children}</PreferencesProvider> });
    expect(result.current.theme).toBe('dark');
    expect(result.current.locale).toBe('he');
  });

  it('falls back to the system theme and English when <html> carries no saved choice', () => {
    setMatchMediaDark(true);
    const { result } = renderHook(() => usePreferences(), { wrapper: ({ children }) => <PreferencesProvider>{children}</PreferencesProvider> });
    expect(result.current.theme).toBe('dark');
    expect(result.current.locale).toBe('en');
  });

  it('setTheme applies to <html>, persists to localStorage, and calls persist()', () => {
    const persist = vi.fn();
    const { result } = renderHook(() => usePreferences(), {
      wrapper: ({ children }) => <PreferencesProvider persist={persist}>{children}</PreferencesProvider>,
    });

    act(() => result.current.setTheme('dark'));

    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('open-ledger-il-theme')).toBe('dark');
    expect(persist).toHaveBeenCalledWith({ theme: 'dark' });
  });

  it('setLocale applies dir="rtl" for Hebrew and dir="ltr" for English', () => {
    const persist = vi.fn();
    const { result } = renderHook(() => usePreferences(), {
      wrapper: ({ children }) => <PreferencesProvider persist={persist}>{children}</PreferencesProvider>,
    });

    act(() => result.current.setLocale('he'));
    expect(result.current.locale).toBe('he');
    expect(document.documentElement.lang).toBe('he');
    expect(document.documentElement.dir).toBe('rtl');
    expect(localStorage.getItem('open-ledger-il-locale')).toBe('he');
    expect(persist).toHaveBeenCalledWith({ locale: 'he' });

    act(() => result.current.setLocale('en'));
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('syncFromServer applies the signed-in user\'s saved choice without calling persist again', () => {
    const persist = vi.fn();
    const { result } = renderHook(() => usePreferences(), {
      wrapper: ({ children }) => <PreferencesProvider persist={persist}>{children}</PreferencesProvider>,
    });

    act(() => result.current.syncFromServer('dark', 'he'));

    expect(result.current.theme).toBe('dark');
    expect(result.current.locale).toBe('he');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(persist).not.toHaveBeenCalled();
  });

  it('syncFromServer with null values (no saved choice yet) leaves the current preference alone', () => {
    const persist = vi.fn();
    document.documentElement.dataset.theme = 'dark';
    const { result } = renderHook(() => usePreferences(), {
      wrapper: ({ children }) => <PreferencesProvider persist={persist}>{children}</PreferencesProvider>,
    });

    act(() => result.current.syncFromServer(null, null));

    expect(result.current.theme).toBe('dark');
    expect(result.current.locale).toBe('en');
    expect(persist).not.toHaveBeenCalled();
  });
});
