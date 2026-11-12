import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { PreferencesProvider } from '../../app/preferences';
import { ToastProvider } from '../../components/Toast';
import type { WiseConnection } from '../wise/api';
import { WiseSection } from './WiseSection';

const api = vi.hoisted(() => ({ get: vi.fn(), connect: vi.fn(), sync: vi.fn(), disconnect: vi.fn() }));
vi.mock('../wise/api', () => ({ wiseApi: api }));

const NONE: WiseConnection = {
  connected: false,
  status: null,
  tokenLast4: null,
  profileName: null,
  lastError: null,
  lastSyncAt: null,
  lastSyncResult: null,
  webhook: { url: null, event: 'balances#update', state: 'manual', lastEventAt: null },
};
const ON: WiseConnection = {
  connected: true,
  status: 'connected',
  tokenLast4: 'wxyz',
  profileName: 'Sample Studio LLC',
  lastError: null,
  lastSyncAt: '2026-11-12T08:00:00.000Z',
  lastSyncResult: { accounts: 2, transactions: 4, new: 4, matched: 0 },
  webhook: { url: 'https://ledger.example.com/v1/hooks/wise/abc', event: 'balances#update', state: 'auto', lastEventAt: null },
};

function show(demo = false) {
  return render(
    <PreferencesProvider persist={() => undefined}>
      <ToastProvider>
        <WiseSection demo={demo} />
      </ToastProvider>
    </PreferencesProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('R49: Settings > Expenses > Wise connection', () => {
  it('is not shown in the demo and asks the server nothing', () => {
    show(true);
    expect(screen.queryByTestId('wise-panel')).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('connects with a token, never shows it again, and says what the first sync pulled', async () => {
    api.get.mockResolvedValue({ connection: NONE });
    api.connect.mockResolvedValue({ connection: ON, sync: ON.lastSyncResult, syncError: null });
    show();
    const field = await screen.findByLabelText('API token');
    fireEvent.change(field, { target: { value: 'wise-token-1234567890' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(api.connect).toHaveBeenCalledWith('wise-token-1234567890', undefined));
    expect(await screen.findByTestId('wise-connected')).toBeTruthy();
    expect(screen.getByTestId('wise-details').textContent).toContain('Saved, ends in wxyz');
    expect(screen.getByTestId('wise-details').textContent).toContain('Sample Studio LLC');
    expect(screen.getByTestId('wise-result').textContent).toBe('Synced: 2 balances, 4 transactions.');
    expect(screen.getByTestId('wise-webhook-state').textContent).toContain('The Ledger created it in Wise');
    expect(screen.queryByTestId('wise-webhook-steps')).toBeNull();
    expect(document.body.textContent).not.toContain('wise-token-1234567890');
  });

  it('shows the webhook address and the steps when the Ledger could not make it in Wise', async () => {
    api.get.mockResolvedValue({ connection: { ...ON, webhook: { ...ON.webhook, state: 'manual' } } });
    show();
    expect((await screen.findByTestId('wise-webhook-url')).textContent).toBe('https://ledger.example.com/v1/hooks/wise/abc');
    expect(screen.getByTestId('wise-webhook-state').textContent).toContain('Not set up yet');
  });

  it('lets the owner pick when the token reaches two Business profiles', async () => {
    api.get.mockResolvedValue({ connection: NONE });
    api.connect
      .mockRejectedValueOnce(new ApiError(409, 'wise_pick_profile', 'Pick one.', { profiles: [{ id: 1, name: 'First LLC' }, { id: 2, name: 'Second LLC' }] }))
      .mockResolvedValueOnce({ connection: ON, sync: null, syncError: null });
    show();
    fireEvent.change(await screen.findByLabelText('API token'), { target: { value: 'wise-token-1234567890' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const select = await screen.findByTestId('wise-profiles');
    fireEvent.change(select, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(api.connect).toHaveBeenLastCalledWith('wise-token-1234567890', 2));
  });

  it('shows why the last sync failed', async () => {
    api.get.mockResolvedValue({ connection: { ...ON, connected: false, status: 'error', lastError: 'Wise refused this token.' } });
    show();
    expect((await screen.findByTestId('wise-error')).textContent).toBe('Wise refused this token.');
  });
});
