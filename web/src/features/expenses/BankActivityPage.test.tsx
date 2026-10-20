import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BankActivityPage } from './BankActivityPage';

/** R40 and R42: Expenses > Bank activity, with the same status column and actions as the Financy Dashboard. */

const base = {
  kind: 'CARD',
  accountId: 'acc-card',
  accountName: 'Business card',
  accountLast4: '9012',
  currency: 'ILS',
  originalAmountMinor: null,
  originalCurrency: null,
  categoryMain: 'SHOPPING',
  categorySub: null,
  category: 'Shopping',
  installment: null,
  expenseId: null,
  suggestion: null,
  flow: 'normal',
};
const OUT = { ...base, id: 1, date: '2026-10-19', amountMinor: -11800, description: 'Purchase 1', merchant: 'Canva', matchStatus: 'unmatched', status: 'to_match' };
const MATCHED = { ...base, id: 2, date: '2026-10-18', amountMinor: -5000, description: 'Purchase 2', merchant: 'Figma', matchStatus: 'matched', status: 'matched', expenseId: 77 };
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
  status: 'suggested',
  suggestion: { documentId: 12, displayNumber: 'PR-0004' },
};
const CARD_BILL = { ...base, id: 4, kind: 'BANK', date: '2026-10-10', amountMinor: -257400, description: 'ישראכרט', merchant: null, matchStatus: 'unmatched', status: 'not_counted', flow: 'card_payment' };

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

const page = (path = '/expenses/bank') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <BankActivityPage />
    </MemoryRouter>,
  );

describe('BankActivityPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens on the month, with a status column and the actions each row allows', async () => {
    const fetchMock = stub({ transactions: [OUT, MATCHED, DEPOSIT, CARD_BILL], accounts: [], canEdit: true });
    page();
    const row = await screen.findByTestId('bank-row-1');
    expect(within(row).getByText('Canva')).toBeInTheDocument();
    expect(within(row).getByText('ILS -118.00')).toBeInTheDocument();
    expect(within(row).getByText('To match')).toBeInTheDocument();
    for (const name of ['Add as expense', 'Match to expense', 'Not a business expense']) expect(within(row).getByRole('button', { name })).toBeInTheDocument();
    expect(within(screen.getByTestId('bank-row-2')).getByRole('link', { name: 'Matched' })).toHaveAttribute('href', '/expenses/77');
    expect(within(screen.getByTestId('bank-row-2')).getByRole('button', { name: 'Unmatch' })).toBeInTheDocument();
    expect(within(screen.getByTestId('bank-row-4')).getByText('Not counted')).toBeInTheDocument();
    expect(within(screen.getByTestId('bank-row-4')).getByRole('button', { name: 'Count this' })).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/financy/transactions?month=${new Date().toISOString().slice(0, 7)}`);
  });

  it('reads its filters from the address, as the dashboard links them', async () => {
    const fetchMock = stub({ transactions: [OUT], accounts: [], canEdit: true });
    page('/expenses/bank?status=unmatched&direction=out');
    await screen.findByTestId('bank-row-1');
    expect(String(fetchMock.mock.calls[0]![0])).toBe('/api/financy/transactions?direction=out&status=unmatched');
    fireEvent.change(screen.getByLabelText('Counted'), { target: { value: 'card_payment' } });
    await screen.findByTestId('bank-row-1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toBe('/api/financy/transactions?direction=out&status=unmatched&flow=card_payment');
  });

  it('Add as expense marks the row matched and links to the new expense', async () => {
    stub({ transactions: [OUT], accounts: [], canEdit: true }, 200, {
      'POST /api/financy/transactions/1/add-expense': { expenseId: 91, transaction: { ...OUT, matchStatus: 'added', status: 'matched', expenseId: 91 } },
    });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Add as expense' }));
    expect(await screen.findByRole('link', { name: 'Matched' })).toHaveAttribute('href', '/expenses/91');
    expect(within(screen.getByTestId('bank-row-1')).queryByRole('button', { name: 'Add as expense' })).toBeNull();
  });

  it('Not a business expense sets the row aside, and it can still be matched by hand', async () => {
    stub({ transactions: [OUT], accounts: [], canEdit: true }, 200, {
      'POST /api/financy/transactions/1/ignore': { transaction: { ...OUT, matchStatus: 'ignored', status: 'not_business' } },
    });
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Not a business expense' }));
    const row = screen.getByTestId('bank-row-1');
    expect(await within(row).findByText('Not business')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Match to expense' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Add as expense' })).toBeNull();
  });

  it('money in with a suggested document opens Record payment there, filled in', async () => {
    stub({ transactions: [DEPOSIT], accounts: [], canEdit: true });
    page();
    const link = await screen.findByRole('link', { name: 'Record payment on PR-0004' });
    expect(link).toHaveAttribute('href', '/income/documents/12?payAmount=123400&payOn=2026-10-17');
  });

  it('the accountant reads only', async () => {
    stub({ transactions: [OUT, MATCHED, DEPOSIT], accounts: [], canEdit: false });
    page();
    await screen.findByTestId('bank-row-1');
    expect(screen.queryByRole('button', { name: 'Add as expense' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Record payment/ })).toBeNull();
    expect(within(screen.getByTestId('bank-row-2')).getByRole('link', { name: 'Open expense' })).toHaveAttribute('href', '/expenses/77');
  });

  it('says how to connect when Financy is not connected', async () => {
    stub({ error: { code: 'financy_not_connected', message: 'Financy is not connected.' } }, 409);
    page();
    expect(await screen.findByText('Financy is not connected. Connect it to see bank and card transactions here.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings > Expenses' })).toHaveAttribute('href', '/settings?tab=expenses');
  });
});
