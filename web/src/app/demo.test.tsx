import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreferencesProvider } from './preferences';
import { announceDemoSend, DemoBanner, DemoOutboxPreview, DemoProvider, useDemoLocked } from './demo';

/** R26: the demo banner, the Settings lock and the email preview. None of it shows on a real Ledger. */

const wrap = (ui: React.ReactNode, demo: { admin: boolean; ctaUrl: string; product: string } | null) =>
  render(
    <PreferencesProvider persist={() => undefined}>
      <DemoProvider value={demo}>{ui}</DemoProvider>
    </PreferencesProvider>,
  );

const demo = { admin: false, ctaUrl: 'https://example.com/own', product: 'Open Ledger IL' };

function LockProbe() {
  return <span>{useDemoLocked() ? 'locked' : 'open'}</span>;
}

describe('R26 demo in the web app', () => {
  it('shows the banner with the call to action, only in the demo', () => {
    const { unmount } = wrap(<DemoBanner />, demo);
    expect(screen.getByText("Demo. Your copy resets every night at 03:00. Don't enter real personal data.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get your own Ledger' })).toHaveAttribute('href', 'https://example.com/own');
    unmount();
    wrap(<DemoBanner />, null);
    expect(screen.queryByTestId('demo-banner')).toBeNull();
  });

  it('locks screens for a visitor, not for the admin or a real Ledger', () => {
    const a = wrap(<LockProbe />, demo);
    expect(screen.getByText('locked')).toBeInTheDocument();
    a.unmount();
    const b = wrap(<LockProbe />, { ...demo, admin: true });
    expect(screen.getByText('open')).toBeInTheDocument();
    b.unmount();
    wrap(<LockProbe />, null);
    expect(screen.getByText('open')).toBeInTheDocument();
  });

  it('opens the email preview after a send: "In your own Ledger this email goes to the client."', async () => {
    const load = vi.fn(async () => ({ emails: [{ to_addr: 'client@example.com', subject: 'Receipt 400-12', text: 'Hello, your receipt is attached.' }] }));
    wrap(<DemoOutboxPreview load={load} />, demo);
    await act(async () => {
      announceDemoSend();
    });
    expect(await screen.findByText('In your own Ledger this email goes to the client.')).toBeInTheDocument();
    expect(screen.getByText('client@example.com')).toBeInTheDocument();
    expect(screen.getByText('Hello, your receipt is attached.')).toBeInTheDocument();
  });
});
