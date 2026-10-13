import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreferencesProvider } from './preferences';
import { announceDemoSend, DemoBanner, DemoOutboxPreview, DemoProvider, DemoReadOnlyNote, type DemoInfo, useDemoLocked, useDemoReadOnly } from './demo';

/** R26, R29: the demo banner, the read-only sample data, the previews. None of it shows on a real Ledger. */

const wrap = (ui: React.ReactNode, demo: DemoInfo | null) =>
  render(
    <PreferencesProvider persist={() => undefined}>
      <DemoProvider value={demo}>{ui}</DemoProvider>
    </PreferencesProvider>,
  );

const demo: DemoInfo = { admin: false, ctaUrl: 'https://example.com/own', product: 'Open Ledger IL', ownKey: 'key-mine' };

function LockProbe() {
  return <span>{useDemoLocked() ? 'locked' : 'open'}</span>;
}

describe('R26 demo in the web app', () => {
  it('shows the banner with the call to action, only in the demo', () => {
    const { unmount } = wrap(<DemoBanner />, demo);
    expect(
      screen.getByText("Demo. The sample data is read-only. Your drafts are private and deleted 30 minutes after you leave. Don't enter real personal data."),
    ).toBeInTheDocument();
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

  it('the banner says the same in Hebrew', async () => {
    const { he } = await import('../i18n/messages/he');
    expect(he['demo.banner']).toBe('הדגמה. נתוני הדוגמה לקריאה בלבד. הטיוטות שלכם פרטיות ונמחקות 30 דקות אחרי שתצאו. אל תזינו מידע אישי אמיתי.');
  });

  it('marks sample rows read-only for a visitor, and the visitor\u2019s own rows editable', () => {
    function Probe({ row }: { row: { demo_session_id?: string | null; status?: string } }) {
      return <span>{useDemoReadOnly(row) ? 'read-only' : 'editable'}</span>;
    }
    const cases: [{ demo_session_id?: string | null; status?: string }, DemoInfo | null, string][] = [
      [{ demo_session_id: null }, demo, 'read-only'],
      [{ demo_session_id: 'key-mine' }, demo, 'editable'],
      [{ demo_session_id: 'key-other' }, demo, 'read-only'],
      [{ status: 'final' }, demo, 'read-only'],
      [{ status: 'draft' }, demo, 'editable'],
      [{ demo_session_id: null }, { ...demo, admin: true }, 'editable'],
      [{ demo_session_id: null }, null, 'editable'],
    ];
    for (const [row, info, expected] of cases) {
      const r = wrap(<Probe row={row} />, info);
      expect(screen.getByText(expected)).toBeInTheDocument();
      r.unmount();
    }
  });

  it('says why in one line', () => {
    wrap(<DemoReadOnlyNote />, demo);
    expect(screen.getByTestId('demo-read-only')).toHaveTextContent('Read-only in the demo. The sample data is shared by every visitor.');
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
