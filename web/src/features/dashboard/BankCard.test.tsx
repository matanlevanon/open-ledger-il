import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BankCard } from './BankCard';

/** R40: the dashboard's Bank card. */

const account = { name: null, currency: 'ILS', balanceType: null, availableMinor: null, creditLimitMinor: null, cardDueDate: null, balances: [], blocked: false, updatedAt: '2026-10-20T07:00:00Z' };

describe('BankCard', () => {
  it('shows one line per currency, the card charge and its charge day, the last sync and a link to Bank activity', () => {
    render(
      <MemoryRouter>
        <BankCard
          bank={{
            status: 'connected',
            lastSyncAt: '2026-10-20T07:00:12.000Z',
            accounts: [
              {
                ...account,
                id: 'a',
                type: 'CHECKING',
                name: 'Current',
                last4: '8901',
                balanceMinor: 1410025,
                balances: [
                  { currency: 'ILS', balanceMinor: 1410025, balanceType: 'interimAvailable' },
                  { currency: 'USD', balanceMinor: 120050, balanceType: 'closingBooked' },
                ],
              },
              { ...account, id: 'c', type: 'CARD', name: 'Card', last4: '9012', balanceMinor: -231040, cardDueDate: '2' },
              { ...account, id: 'd', type: 'CARD', name: 'Other card', last4: '3344', balanceMinor: -50000, cardDueDate: '2026-11-10' },
            ],
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('Current ··8901')).toHaveLength(2);
    expect(screen.getByText('ILS 14100.25')).toBeInTheDocument();
    expect(screen.getByText('USD 1200.50')).toBeInTheDocument();
    expect(screen.getByText('Charged so far ILS 2310.40')).toBeInTheDocument();
    expect(screen.getByText('Charged on day 2')).toBeInTheDocument();
    expect(screen.getByText('Due 2026-11-10')).toBeInTheDocument();
    expect(screen.getByText('Last sync 2026-10-20 07:00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bank activity' })).toHaveAttribute('href', '/expenses/bank');
  });
});
