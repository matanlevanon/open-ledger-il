import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BankActivityPage } from './BankActivityPage';

/** R40: Expenses > Bank activity. */

const base = {
  kind: 'CARD',
  accountId: 'acc-card',
  accountName: 'Business card',
  accountLast4: '9012',
  currency: 'ILS',
  originalAmountMinor: null,
  originalCurrency: null,
  category: 'Shopping',
  installment: null,
  expenseId: null,
  suggestion: null,
};
const OUT = { ...base, id: 1, date: '2026-10-19', amountMinor: -11800, description: 'Purchase 1', merchant: 'Canva', matchStatus: 'unmatched' };
const MATCHED = { ...base, id: 2, date: '2026-10-18', amountMinor: -5000, description: 'Purchase 2', merchant: 'Figma', matchStatus: 'matched', expenseId: 77 };
const DEPOSIT = {
  ...base,
  id: 3,
  kind: 'BANK',
  accountId: 'acc-checking',
  date: '2026-10-17',
  amountMinor: 123400,
  description: 'Transfer from client',
  merchant: null,
  matchStatus: 'unmatched',
  suggestion: { documentId: 12, displayNumber: 'PR-0004' },
};

function stub(body: unknown, status = 200, actions: Record<string, unknown> = {}) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.startsWith('/api/financy/transactions')) return new Response(JSON.stringify(body), { status });
    const key = `${method} ${url}`;
    if (key in actions) return new Response(JSON.stringify(actions[key]), { status: 200 });
    throw new Error(`No mock for ${key}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const page = () =>
  render(
    <MemoryRouter>
      <BankActivityPage />
    </MemoryRouter>,
  );

describe('BankActivityPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists the month, with Add as expense and Not a business expense on unmatched money out', async () => {
    const fetchMock = stub({ transactions: [OUT, MATCHED, DEPOSIT], accounts: [], canEdit: true });
    page();
    const row = await screen.findByTestId('bank-row-1');
    expect(within(row).getByText('Canva')).toBeInTheDocument();
    expect(within(row).getByText('ILS -118.00')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Add as expense' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Not a business expense' })).toBeInTheDocument();
    expect(within(screen.getByTestId('bank-row-2')).getByRole('link', { name: 'Open expense' })).toHaveAttribute('href', '/expenses/77');
    expect(within(screen.getByTestId('bank-row-2')).queryByRole('button')).toBeNull();
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/financy/transactions?month=${new Date().toISOString().slice(0, 7)}`);
  });

  it('Add as expense marks the row Added and links to the new expense', async () => {
    stub({ transactions: [OUT], accounts: [], canEdit: true }, 200, {
      'POST /api/financy/transactions/1/add-expense': { expenseId: 91, transaction: { ...OUT, matchStatus: 'added', expenseId: 91 } },
    });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Add as expense' }));
    const link = await screen.findByRole('link', { name: 'Open expense' });
    expect(link).toHaveAttribute('href', '/expenses/91');
    expect(within(screen.getByTestId('bank-row-1')).getByText('Added')).toBeInTheDocument();
  });

  it('Not a business expense sets the row aside', async () => {
    stub({ transactions: [OUT], accounts: [], canEdit: true }, 200, {
      'POST /api/financy/transactions/1/ignore': { transaction: { ...OUT, matchStatus: 'ignored' } },
    });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Not a business expense' }));
    expect(await within(screen.getByTestId('bank-row-1')).findByText('Not a business expense', { selector: 'span' })).toBeInTheDocument();
    expect(within(screen.getByTestId('bank-row-1')).queryByRole('button')).toBeNull();
  });

  it('money in with a suggested document opens Record payment there, filled in', async () => {
    stub({ transactions: [DEPOSIT], accounts: [], canEdit: true });
    page();
    const link = await screen.findByRole('link', { name: 'Record payment on PR-0004' });
    expect(link).toHaveAttribute('href', '/income/documents/12?payAmount=123400&payOn=2026-10-17');
  });

  it('the accountant reads only', async () => {
    stub({ transactions: [OUT, DEPOSIT], accounts: [], canEdit: false });
    page();
    await screen.findByTestId('bank-row-1');
    expect(screen.queryByRole('button', { name: 'Add as expense' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Record payment/ })).toBeNull();
  });

  it('says how to connect when Financy is not connected', async () => {
    stub({ error: { code: 'financy_not_connected', message: 'Financy is not connected.' } }, 409);
    page();
    expect(await screen.findByText('Financy is not connected. Connect it to see bank and card transactions here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings > Expenses' })).toHaveAttribute('href', '/settings?tab=expenses');
  });
});
