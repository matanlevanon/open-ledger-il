import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WhatsAppDueItem } from '../../api/dashboard';
import { PreferencesProvider } from '../../app/preferences';
import { ClientReminders } from '../documents/ClientReminders';
import { WhatsAppDue } from './WhatsAppDue';

/** R28 task 7: the dashboard WhatsApp line and the client page Reminders list. */

const ITEMS: WhatsAppDueItem[] = [
  { id: 41, clientId: 7, clientName: 'Phone Only Ltd', targetKind: 'document', targetId: 12, label: 'PR 1', rules: ['before_3'], phone: '050-1112222' },
  { id: 42, clientId: 7, clientName: 'Phone Only Ltd', targetKind: 'contract', targetId: 9, label: 'Retainer', rules: ['unsigned_3'], phone: '052-3334444' },
];

const calls: string[] = [];
const tab = { location: { href: '' }, close: vi.fn() };

beforeEach(() => {
  calls.length = 0;
  tab.location.href = '';
  vi.stubGlobal('open', vi.fn(() => tab));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      calls.push(key);
      if (key === 'POST /api/dashboard/reminders/41/share') return new Response(JSON.stringify({ waUrl: 'https://wa.me/972501112222?text=hi' }), { status: 200 });
      if (key === 'GET /api/sending/clients/7/reminders')
        return new Response(
          JSON.stringify({
            reminders: [
              { id: 3, targetKind: 'contract', targetId: 9, channel: 'email', rule: 'unsigned_7', result: 'sent', label: 'Retainer', at: '2026-10-13T07:00:00Z' },
              { id: 2, targetKind: 'document', targetId: 12, channel: 'whatsapp_due', rule: 'after_3', result: 'shared', label: 'PR 1', at: '2026-10-12T07:00:00Z' },
            ],
          }),
          { status: 200 },
        );
      return new Response(JSON.stringify({ error: { code: 'not_found', message: key } }), { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const wrap = (ui: React.ReactNode) =>
  render(
    <MemoryRouter>
      <PreferencesProvider persist={() => undefined}>{ui}</PreferencesProvider>
    </MemoryRouter>,
  );

describe('R28 reminders due on WhatsApp', () => {
  it('lists each due item with Share on WhatsApp, which opens the message and leaves the list', async () => {
    wrap(<WhatsAppDue items={ITEMS} />);
    expect(screen.getByText('Reminders due on WhatsApp today')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Retainer' })).toHaveAttribute('href', '/contracts/9');
    expect(screen.getByRole('link', { name: 'PR 1' })).toHaveAttribute('href', '/income/documents/12');
    fireEvent.click(screen.getAllByRole('button', { name: 'Share on WhatsApp' })[0]!);
    await waitFor(() => expect(tab.location.href).toBe('https://wa.me/972501112222?text=hi'));
    expect(calls).toContain('POST /api/dashboard/reminders/41/share');
    await waitFor(() => expect(screen.queryByRole('link', { name: 'PR 1' })).toBeNull());
    expect(screen.getByRole('link', { name: 'Retainer' })).toBeInTheDocument();
  });

  it('shows nothing when no reminder is due', () => {
    const { container } = wrap(<WhatsAppDue items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('the client page lists every reminder with its rule and result', async () => {
    wrap(<ClientReminders clientId={7} />);
    const list = await screen.findByTestId('client-reminders');
    expect(list).toHaveTextContent('7 days unsigned · emailed');
    expect(list).toHaveTextContent('3 days overdue · shared on WhatsApp');
  });
});
