import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/Toast';
import { GMAIL_SEARCH, InboxSection } from './InboxSection';

/** R35 task 4: Settings > Expenses > Email inbox. */

const calls: { key: string; body: unknown }[] = [];
let state: Record<string, unknown>;
const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  calls.length = 0;
  writeText.mockClear();
  state = {
    configured: true,
    address: 'r7k2m9x4qp@in.example.com',
    enabled: true,
    senders: ['owner@example.com'],
    gmail: null,
    events: [
      { id: 2, at: '2026-10-16T09:00:00.000Z', sender: 'stranger@else.test', subject: 'Hi', outcome: 'ignored', expense_id: null },
      { id: 1, at: '2026-10-15T09:00:00.000Z', sender: 'owner@example.com', subject: 'Receipt', outcome: 'expense', expense_id: 7 },
    ],
    canRotate: true,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ key, body });
      if (key === 'GET /api/expenses/settings/inbox') return new Response(JSON.stringify(state), { status: 200 });
      if (key === 'PUT /api/expenses/settings/inbox/senders') return new Response(JSON.stringify(body), { status: 200 });
      if (key === 'PUT /api/expenses/settings/inbox/enabled') return new Response(JSON.stringify(body), { status: 200 });
      if (key === 'POST /api/expenses/settings/inbox/rotate') return new Response(JSON.stringify({ ...state, address: 'newaddress@in.example.com' }), { status: 200 });
      return new Response('{}', { status: 404 });
    }),
  );
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => vi.unstubAllGlobals());

const renderIt = () =>
  render(
    <ToastProvider>
      <InboxSection />
    </ToastProvider>,
  );

describe('Settings > Expenses > Email inbox', () => {
  it('shows the address with Copy, the senders line, and the last emails', async () => {
    renderIt();
    expect(await screen.findByTestId('inbox-address')).toHaveTextContent('r7k2m9x4qp@in.example.com');
    expect(screen.getByText('Only email forwarded from these addresses becomes an expense.')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-events')).toHaveTextContent('Ignored, from stranger@else.test, not on your list');
    expect(screen.getByTestId('inbox-events')).toHaveTextContent('Expense created');
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0]!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('r7k2m9x4qp@in.example.com'));
    expect(screen.queryByTestId('inbox-gmail')).toBeNull();
  });

  it('shows the Gmail confirmation code and link when one arrived', async () => {
    state = { ...state, gmail: { code: '123456', link: 'https://mail-settings.google.com/mail/vf-x', at: '2026-10-16T08:00:00.000Z' } };
    renderIt();
    expect(await screen.findByTestId('inbox-gmail')).toHaveTextContent('Gmail sent a confirmation code: 123456');
    expect(screen.getByRole('link', { name: 'Open the confirmation link' })).toHaveAttribute('href', 'https://mail-settings.google.com/mail/vf-x');
  });

  it('adds and removes a sender', async () => {
    renderIt();
    await screen.findByTestId('inbox-senders');
    fireEvent.change(screen.getByLabelText('Add sender'), { target: { value: 'Partner@Example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add sender' }));
    await waitFor(() => expect(calls.find((c) => c.key === 'PUT /api/expenses/settings/inbox/senders')?.body).toEqual({ senders: ['owner@example.com', 'partner@example.com'] }));
    expect(await screen.findByText('partner@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);
    await waitFor(() => expect(calls.filter((c) => c.key === 'PUT /api/expenses/settings/inbox/senders').at(-1)?.body).toEqual({ senders: ['partner@example.com'] }));
  });

  it('has the copyable Gmail search, editable', async () => {
    renderIt();
    const field = (await screen.findByTestId('inbox-search')) as HTMLInputElement;
    expect(field.value).toBe(GMAIL_SEARCH);
    fireEvent.change(field, { target: { value: `${GMAIL_SEARCH} from:(billing@supplier.com)` } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[1]!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${GMAIL_SEARCH} from:(billing@supplier.com)`));
  });

  it('turns the inbox off', async () => {
    renderIt();
    fireEvent.click(await screen.findByRole('switch'));
    await waitFor(() => expect(calls.find((c) => c.key === 'PUT /api/expenses/settings/inbox/enabled')?.body).toEqual({ enabled: false }));
  });

  it('asks before a new address, then shows it', async () => {
    renderIt();
    fireEvent.click(await screen.findByRole('button', { name: 'Make a new address' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('The current address stops working now. Update your Gmail filter with the new one.');
    expect(calls.some((c) => c.key === 'POST /api/expenses/settings/inbox/rotate')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Make the address' }));
    await waitFor(() => expect(screen.getByTestId('inbox-address')).toHaveTextContent('newaddress@in.example.com'));
  });

  it('says how to set it up when there is no address yet', async () => {
    state = { ...state, configured: false, address: null, canRotate: false };
    renderIt();
    expect(await screen.findByTestId('inbox-not-set-up')).toHaveTextContent('No inbox address from the installer.');
    expect(screen.queryByRole('button', { name: 'Make a new address' })).toBeNull();
  });

  it('shows the Gmail confirmation link with no gateway address (own-domain route)', async () => {
    state = { ...state, configured: false, address: null, canRotate: false, gmail: { code: null, link: 'https://mail.google.com/mail/vf-abc', at: '2026-10-17T20:46:08.951Z' } };
    renderIt();
    expect(await screen.findByTestId('inbox-gmail')).toHaveTextContent('Gmail sent a confirmation email.');
    expect(screen.getByRole('link', { name: 'Open the confirmation link' })).toHaveAttribute('href', 'https://mail.google.com/mail/vf-abc');
  });

  it('stays hidden for a 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'forbidden', message: 'No' } }), { status: 403 })));
    renderIt();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('inbox-section')).toBeNull();
  });
});
