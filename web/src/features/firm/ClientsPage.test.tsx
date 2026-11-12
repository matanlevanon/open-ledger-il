import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreferencesProvider } from '../../app/preferences';
import { type ClientRow, ClientsPage } from './ClientsPage';

const row = (id: number, nameEn: string, extra: Partial<ClientRow> = {}): ClientRow => ({
  id,
  nameEn,
  nameHe: '',
  taxId: `51400000${id}`,
  entityType: 'company',
  status: 'active',
  vat: { due: '2026-12-15', amountMinor: 12345 },
  ceiling: null,
  ita: 'connected',
  signingNotAfter: '2036-01-01',
  unifiedFileSent: true,
  openPaymentRequests: 2,
  expensesToReview: 0,
  lastActivity: '2026-11-10',
  needsAttention: false,
  ...extra,
});

describe('R48 Clients page', () => {
  it('lists one row per client, filters needs attention, and opens a business', async () => {
    const load = vi.fn(async (p: { attention: boolean }) => ({
      total: 2,
      page: 1,
      pageSize: 25,
      clients: p.attention ? [row(2, 'Bet Ltd', { needsAttention: true })] : [row(1, 'Alef Ltd'), row(2, 'Bet Ltd', { needsAttention: true })],
    }));
    const open = vi.fn();
    render(
      <PreferencesProvider persist={() => undefined}>
        <ClientsPage load={load} open={open} />
      </PreferencesProvider>,
    );
    expect(await screen.findAllByTestId('client-row')).toHaveLength(2);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Needs attention' }));
    await waitFor(() => expect(screen.getAllByTestId('client-row')).toHaveLength(1));
    fireEvent.click(screen.getAllByTestId('client-row')[0]!);
    expect(open).toHaveBeenCalledWith(2);
  });

  it('a client owner sees the refusal', async () => {
    render(
      <PreferencesProvider persist={() => undefined}>
        <ClientsPage load={async () => Promise.reject(new Error('403'))} open={vi.fn()} />
      </PreferencesProvider>,
    );
    expect(await screen.findByText('The Clients page is for the firm team.')).toBeTruthy();
  });
});
