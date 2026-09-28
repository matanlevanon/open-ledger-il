import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Me } from '../api/client';
import { PreferencesProvider } from '../app/preferences';
import { TopBar } from './TopBar';

const me: Me = { email: 'owner@example.com', name: 'Sample Owner', role: 'owner', features: [], theme: null, locale: null };

function renderTopBar() {
  return render(
    <MemoryRouter>
      <PreferencesProvider persist={() => undefined}>
        <TopBar me={me} error={null} onMenu={() => undefined} />
      </PreferencesProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  delete document.documentElement.dataset.theme;
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
});

describe('TopBar', () => {
  it('shows the theme toggle offering to switch to dark by default', () => {
    renderTopBar();
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
  });

  it('switching the theme toggle flips <html> and the button label', () => {
    renderTopBar();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });

  it('shows the language toggle offering Hebrew by default, labeled עב', () => {
    renderTopBar();
    const button = screen.getByRole('button', { name: 'Switch to Hebrew' });
    expect(button).toHaveTextContent('עב');
  });

  it('switching the language toggle sets dir="rtl", flips the button to EN, and its own aria-label to Hebrew', () => {
    renderTopBar();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Hebrew' }));
    expect(document.documentElement.lang).toBe('he');
    expect(document.documentElement.dir).toBe('rtl');
    // The toggle's aria-label follows the now-current locale too: it offers "switch to English", in Hebrew.
    const button = screen.getByRole('button', { name: 'עבור לאנגלית' });
    expect(button).toHaveTextContent('EN');
  });

  it('shows the signed-in user name and role chip', () => {
    renderTopBar();
    expect(screen.getByText('Sample Owner')).toBeInTheDocument();
    expect(screen.getByTestId('role-chip')).toHaveTextContent('owner');
  });
});
