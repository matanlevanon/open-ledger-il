import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreferencesProvider } from '../../app/preferences';
import { ToastProvider } from '../../components/Toast';
import { FinancySection } from './FinancySection';

/** R40: the Financy connection panel under Settings > Expenses. */

const NONE = { connected: false, status: null, clientId: null, secretLast4: null, userId: null, lastError: null, lastSyncAt: null, lastSyncResult: null, accountIds: [], needsAccounts: false };
const CONNECTED = {
  connected: true,
  status: 'connected',
  clientId: 'client-1',
  secretLast4: 'abcd',
  userId: 'user-1',
  lastError: null,
  lastSyncAt: '2026-10-20T07:00:00.000Z',
  lastSyncResult: { accounts: 2, transactions: 60, new: 60, matched: 3 },
  accountIds: ['acc-checking', 'acc-card'],
  needsAccounts: false,
};
const NEEDS = { ...CONNECTED, lastSyncAt: null, lastSyncResult: null, accountIds: [], needsAccounts: true };
const AVAILABLE = [
  { id: 'acc-checking', type: 'CHECKING', provider: 'hapoalim', name: 'Business current account', last4: '8901', currencies: ['ILS'], blocked: false, dueDay: null, picked: false },
  { id: 'acc-card', type: 'CARD', provider: 'isracard', name: 'Business card', last4: '9012', currencies: ['ILS'], blocked: false, dueDay: '2', picked: false },
  { id: 'acc-old', type: 'CARD', provider: 'cal', name: 'Old card', last4: '1111', currencies: [], blocked: true, dueDay: '15', picked: false },
];

type Handler = (init?: RequestInit) => Response;
function stub(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${new URL(String(input), 'http://localhost').pathname}`;
    const handler = routes[key];
    if (!handler) throw new Error(`No mock for ${key}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const ok = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function show(demo = false) {
  render(
    <PreferencesProvider persist={() => undefined}>
      <ToastProvider>
        <FinancySection demo={demo} />
      </ToastProvider>
    </PreferencesProvider>,
  );
}

describe('FinancySection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('not connected: three fields, the secret hidden, and a Connect button on the card', async () => {
    stub({ 'GET /api/financy': ok({ connection: NONE }) });
    show();
    const panel = await screen.findByTestId('financy-panel');
    expect(within(panel).getByText('Find them in Financy: Settings > API.')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Client Secret')).toHaveAttribute('type', 'password');
    expect(within(panel).getByRole('button', { name: 'Connect' })).toBeDisabled();
    expect(within(screen.getByTestId('financy-card')).getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    expect(screen.queryByTestId('financy-connected')).toBeNull();
  });

  it('connects, opens the account picker with nothing ticked, and pulls only the ticked accounts', async () => {
    const fetchMock = stub({
      'GET /api/financy': ok({ connection: NONE }),
      'PUT /api/financy': ok({ connection: NEEDS, accounts: AVAILABLE }),
      'PUT /api/financy/picked-accounts': ok({ connection: CONNECTED, sync: { accounts: 2, transactions: 60, new: 60, matched: 3 }, deletedTransactions: 0 }),
    });
    show();
    const panel = await screen.findByTestId('financy-panel');
    fireEvent.change(within(panel).getByLabelText('Client ID'), { target: { value: 'client-1' } });
    fireEvent.change(within(panel).getByLabelText('Client Secret'), { target: { value: 'secret-abcd' } });
    fireEvent.change(within(panel).getByLabelText('User ID'), { target: { value: 'user-1' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Connect' }));

    const picker = await screen.findByTestId('financy-picker');
    const boxes = within(picker).getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    expect(boxes.every((b) => !(b as HTMLInputElement).checked)).toBe(true);
    expect(within(picker).getByText('Blocked')).toBeInTheDocument();
    expect(within(picker).getByText(/Charged on day 2/)).toBeInTheDocument();
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    fireEvent.click(within(picker).getByRole('button', { name: 'Save and pull' }));

    expect(await screen.findByText('Connected. 2 accounts, 60 transactions.')).toBeInTheDocument();
    expect(screen.getByText('Secret saved, ends in abcd')).toBeInTheDocument();
    expect(screen.getByTestId('financy-connected')).toHaveTextContent('Connected');
    const connectCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT' && String(c[0]).endsWith('/api/financy'))!;
    expect(JSON.parse(String(connectCall[1]!.body))).toEqual({ clientId: 'client-1', clientSecret: 'secret-abcd', userId: 'user-1' });
    const pickCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/picked-accounts'))!;
    expect(JSON.parse(String(pickCall[1]!.body))).toEqual({ accountIds: ['acc-checking', 'acc-card'], confirm: false });
    expect(screen.queryByDisplayValue('secret-abcd')).toBeNull();
  });

  it('connected with no account picked: says to choose, and Choose accounts opens the picker', async () => {
    stub({ 'GET /api/financy': ok({ connection: NEEDS }), 'GET /api/financy/available-accounts': ok({ accounts: AVAILABLE }) });
    show();
    expect(await screen.findByText('Choose the business accounts to start.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose accounts' }));
    expect(await screen.findByTestId('financy-picker')).toBeInTheDocument();
  });

  it('unticking an account with stored rows asks first, then sends the confirm', async () => {
    const calls: unknown[] = [];
    stub({
      'GET /api/financy': ok({ connection: CONNECTED }),
      'GET /api/financy/available-accounts': ok({ accounts: AVAILABLE.map((a) => ({ ...a, picked: a.id !== 'acc-old' })) }),
      'PUT /api/financy/picked-accounts': (init) => {
        const body = JSON.parse(String(init?.body));
        calls.push(body);
        return body.confirm
          ? new Response(JSON.stringify({ connection: { ...CONNECTED, accountIds: ['acc-checking'] }, sync: { accounts: 1, transactions: 24, new: 0, matched: 0 }, deletedTransactions: 36 }), { status: 200 })
          : new Response(JSON.stringify({ error: { code: 'financy_unpick', message: 'Unticking this account deletes its 36 stored transactions. Confirm to go on.' } }), { status: 409 });
      },
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose accounts' }));
    const picker = await screen.findByTestId('financy-picker');
    fireEvent.click(within(picker).getAllByRole('checkbox')[1]!);
    fireEvent.click(within(picker).getByRole('button', { name: 'Save and pull' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Unticking this account deletes its 36 stored transactions. Confirm to go on.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete and save' }));
    expect(await screen.findByText('Connected. 1 accounts, 24 transactions.')).toBeInTheDocument();
    expect(calls).toEqual([
      { accountIds: ['acc-checking'], confirm: false },
      { accountIds: ['acc-checking'], confirm: true },
    ]);
  });

  it('a refused Connect shows the plain message and keeps the form', async () => {
    stub({
      'GET /api/financy': ok({ connection: NONE }),
      'PUT /api/financy': ok({ error: { code: 'financy_plan', message: 'Your Financy plan has no API access. Starter or higher is needed.' } }, 409),
    });
    show();
    const panel = await screen.findByTestId('financy-panel');
    for (const name of ['Client ID', 'Client Secret', 'User ID']) fireEvent.change(within(panel).getByLabelText(name), { target: { value: 'x1234' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Your Financy plan has no API access. Starter or higher is needed.')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Client ID')).toBeInTheDocument();
  });

  it('connected: Sync now, Replace details, and Disconnect after a confirm', async () => {
    const fetchMock = stub({
      'GET /api/financy': ok({ connection: CONNECTED }),
      'POST /api/financy/sync': ok({ connection: CONNECTED, sync: { accounts: 2, transactions: 61, new: 1, matched: 0 } }),
      'DELETE /api/financy': ok({ connection: NONE }),
    });
    show();
    expect(await screen.findByText('2026-10-20 07:00, 2 accounts, 60 transactions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText('Synced. 61 transactions, 1 new.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace details' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(screen.getByText('Disconnect Financy? Bank data already pulled stays until you delete it.')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(true));
    expect(await screen.findByLabelText('Client ID')).toBeInTheDocument();
  });

  it('Delete bank data asks first', async () => {
    const fetchMock = stub({
      'GET /api/financy': ok({ connection: CONNECTED }),
      'DELETE /api/financy/data': ok({ deleted: { accounts: 2, transactions: 60 } }),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete bank data' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete bank data' }));
    expect(await screen.findByText('Bank data deleted. 60 transactions removed.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/financy/data'))).toBe(true);
  });

  it('error: the message and Replace details', async () => {
    stub({ 'GET /api/financy': ok({ connection: { ...CONNECTED, connected: false, status: 'error', lastError: 'Financy refused these details. Copy them again from Financy > Settings > API.' } }) });
    show();
    expect(await screen.findByTestId('financy-error')).toHaveTextContent('Financy refused these details.');
    expect(screen.getByRole('button', { name: 'Replace details' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
  });

  it('the demo shows the card alone and asks nothing', () => {
    const fetchMock = stub({});
    show(true);
    expect(screen.getByTestId('financy-card')).toBeInTheDocument();
    expect(screen.queryByTestId('financy-panel')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
