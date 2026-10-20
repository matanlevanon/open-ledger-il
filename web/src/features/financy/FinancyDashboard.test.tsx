import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreferencesProvider } from '../../app/preferences';
import type { BankTransaction, FinancyDashboardData } from './api';
import { FinancyDashboard } from './FinancyDashboard';

/** R42: Dashboard > Financy Dashboard. */

const tx = (id: number, over: Partial<BankTransaction>): BankTransaction => ({
  id,
  date: '2026-10-15',
  kind: 'BANK',
  accountId: 'acc-checking',
  accountName: 'Current',
  accountLast4: '1112',
  amountMinor: -1000,
  currency: 'ILS',
  originalAmountMinor: null,
  originalCurrency: null,
  description: `Row ${id}`,
  merchant: null,
  categoryMain: 'SHOPPING',
  categorySub: null,
  category: 'Shopping',
  installment: null,
  matchStatus: 'unmatched',
  flow: 'normal',
  status: 'to_match',
  expenseId: null,
  suggestion: null,
  ...over,
});

const RECENT: BankTransaction[] = [
  tx(1, { merchant: 'Google One', amountMinor: -1900 }),
  tx(2, { description: 'Client deposit', amountMinor: 750000, categoryMain: 'DEPOSIT' }),
  tx(3, { description: 'Deposit with doc', amountMinor: 123400, status: 'suggested', suggestion: { documentId: 12, displayNumber: 'PR-0004' } }),
  tx(4, { description: 'Matched one', status: 'matched', matchStatus: 'matched', expenseId: 77 }),
  tx(5, { description: 'Isracard bill', amountMinor: -257400, flow: 'card_payment', status: 'not_counted' }),
];

const DASH: FinancyDashboardData = {
  accountCount: 4,
  lastSyncAt: '2026-10-20T07:00:00.000Z',
  status: 'connected',
  months: 3,
  liquidity: { cash: 1974210, cardsCurrent: 281040, net: 1693170 },
  month: {
    month: '2026-10',
    previousMonth: '2026-09',
    current: { income: 2724700, expenses: 1049400, net: 1675300 },
    previous: { income: 6054600, expenses: 4372500, net: 1682100 },
    changePct: { income: -55, expenses: -76, net: -1 },
  },
  cashflow: [
    { month: '2026-08', income: 4400000, expenses: 6800000 },
    { month: '2026-09', income: 6054600, expenses: 4372500 },
    { month: '2026-10', income: 2724700, expenses: 1049400 },
  ],
  categories: {
    expenses: {
      total: 1000000,
      rows: [
        { key: 'TRANSFER', label: 'Transfers', amount: 450000, shareBp: 4500 },
        { key: 'FINANCE', label: 'Finance', amount: 300000, shareBp: 3000 },
        { key: 'OTHER_REST', label: 'Other', amount: 250000, shareBp: 2500 },
      ],
    },
    income: { total: 0, rows: [] },
  },
  accounts: {
    checking: {
      totals: { ILS: 1410025, USD: 120050 },
      rows: [
        { id: 'acc-checking', provider: 'hapoalim', name: 'Current', last4: '1112', balances: [{ currency: 'ILS', balanceMinor: 1410025, ilsMinor: 1410025 }] },
        { id: 'acc-fx', provider: 'hapoalim', name: 'Foreign', last4: '1112', balances: [{ currency: 'USD', balanceMinor: 120050, ilsMinor: 444185 }] },
      ],
    },
    cards: {
      totalCurrent: 281040,
      rows: [
        { id: 'acc-card', provider: 'isracard', name: 'Isracard', last4: '3125', currentMinor: 231040, statementMinor: 48800, dueDay: '2', blocked: false },
        { id: 'acc-old', provider: 'cal', name: 'Old Cal', last4: '1901', currentMinor: 0, statementMinor: 0, dueDay: null, blocked: true },
      ],
    },
  },
  recent: RECENT,
  toMatch: { out: { count: 7, sum: 1250000 }, in: { count: 1, sum: 123400 } },
  excluded: { sum: 757000, ownTransfer: 500000, cardPayment: 257000 },
  unconverted: [],
};

function stub(dashboard: FinancyDashboardData | null, extra: Record<string, (init?: RequestInit) => Response> = {}) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`;
    if (key === 'GET /api/financy/dashboard') return new Response(JSON.stringify({ dashboard }), { status: 200 });
    const handler = extra[key];
    if (handler) return handler(init);
    throw new Error(`No mock for ${key}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function show() {
  render(
    <PreferencesProvider persist={() => undefined}>
      <MemoryRouter initialEntries={['/?view=financy']}>
        <Routes>
          <Route path="/" element={<FinancyDashboard />} />
          <Route path="/income/documents/:id" element={<p>document page</p>} />
        </Routes>
      </MemoryRouter>
    </PreferencesProvider>,
  );
}

describe('FinancyDashboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
  });

  it('shows the four tiles with the change against last month, and what was not counted', async () => {
    stub(DASH);
    show();
    expect(await screen.findByTestId('tile-liquidity')).toHaveTextContent('₪16,932');
    expect(screen.getByTestId('tile-liquidity')).toHaveTextContent('Loans and mortgage are not counted.');
    expect(screen.getByTestId('tile-income')).toHaveTextContent('₪27,247');
    expect(screen.getByTestId('tile-income')).toHaveTextContent('↓ 55% vs last month');
    expect(within(screen.getByTestId('tile-income')).getByText('55%').parentElement).toHaveClass('text-danger');
    expect(within(screen.getByTestId('tile-expenses')).getByText('76%').parentElement).toHaveClass('text-success');
    expect(screen.getByTestId('tile-net')).toHaveTextContent('₪16,753');
    expect(screen.getByTestId('not-counted')).toHaveTextContent('Not counted: ₪7,570 moved between your accounts and paid to credit cards.');
    expect(screen.getByText('Business accounts picked in Settings > Expenses. 4 accounts.')).toBeInTheDocument();
  });

  it('pairs the cash flow chart with its numbers, and lists the categories with Other', async () => {
    stub(DASH);
    show();
    const table = await screen.findByTestId('cashflow-table');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(table).toHaveTextContent('₪60,546');
    const list = screen.getByTestId('category-list');
    expect(within(list).getByText('Transfers')).toBeInTheDocument();
    expect(within(list).getByText('Other')).toBeInTheDocument();
    expect(within(list).getByText('45%')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('categories')).getByRole('button', { name: 'Income' }));
    expect(await screen.findByText('No rows to sort by category yet.')).toBeInTheDocument();
  });

  it('shows the accounts with provider badges and the last statement, a blocked card greyed, and the Original / ₪ switch', async () => {
    stub(DASH);
    show();
    const accounts = await screen.findByTestId('accounts');
    expect(within(accounts).getAllByTestId('provider-badge').length).toBe(4);
    expect(within(screen.getByTestId('card-acc-card')).getByText('Last statement ₪488')).toBeInTheDocument();
    expect(screen.getByTestId('card-acc-old')).toHaveClass('opacity-50');
    expect(within(screen.getByTestId('card-acc-old')).getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByTestId('checking-totals')).toHaveTextContent('₪14,100.25$1,200.50');
    fireEvent.click(within(accounts).getByRole('button', { name: '₪' }));
    expect(screen.getByTestId('checking-totals')).toHaveTextContent('₪19,742');
  });

  it('shows each row with its status and the actions it allows', async () => {
    stub(DASH);
    show();
    const out = await screen.findByTestId('recent-1');
    expect(within(out).getByText('To match')).toBeInTheDocument();
    for (const name of ['Add as expense', 'Match to expense', 'Not a business expense']) expect(within(out).getByRole('button', { name })).toBeInTheDocument();
    expect(within(screen.getByTestId('recent-2')).getByRole('button', { name: 'Match to document' })).toBeInTheDocument();
    expect(within(screen.getByTestId('recent-2')).getByText('+₪7,500.00')).toBeInTheDocument();
    const suggested = screen.getByTestId('recent-3');
    expect(within(suggested).getByText('Suggested')).toBeInTheDocument();
    expect(within(suggested).getByRole('link', { name: 'Record payment on PR-0004' })).toHaveAttribute('href', '/income/documents/12?payAmount=123400&payOn=2026-10-15');
    expect(within(suggested).getByRole('button', { name: 'Unmatch' })).toBeInTheDocument();
    const matched = screen.getByTestId('recent-4');
    expect(within(matched).getByRole('link', { name: 'Matched' })).toHaveAttribute('href', '/expenses/77');
    expect(within(screen.getByTestId('recent-5')).getByText('Not counted')).toBeInTheDocument();
    expect(within(screen.getByTestId('recent-5')).getByRole('button', { name: 'Count this' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show all' })).toHaveAttribute('href', '/expenses/bank?month=2026-10');
    expect(within(screen.getByTestId('to-match')).getAllByRole('link')[0]).toHaveAttribute('href', '/expenses/bank?status=unmatched&direction=out');
  });

  it('Count this counts the row and reloads the numbers', async () => {
    const fetchMock = stub(DASH, {
      'POST /api/financy/transactions/5/count': () => new Response(JSON.stringify({ transaction: { ...RECENT[4], flow: 'normal', status: 'to_match' } }), { status: 200 }),
    });
    show();
    fireEvent.click(within(await screen.findByTestId('recent-5')).getByRole('button', { name: 'Count this' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/api/financy/dashboard')).length).toBe(2));
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/financy/transactions/5/count')).toBe(true);
  });

  it('Match to expense lists candidates and matches the one picked', async () => {
    const fetchMock = stub(DASH, {
      'GET /api/financy/transactions/1/candidates': () =>
        new Response(JSON.stringify({ candidates: [{ kind: 'expense', id: 31, label: 'Google / INV-9', date: '2026-10-14', amountMinor: 1900, currency: 'ILS' }] }), { status: 200 }),
      'PUT /api/financy/transactions/1/match': () => new Response(JSON.stringify({ transaction: { ...RECENT[0], status: 'matched', matchStatus: 'matched', expenseId: 31 } }), { status: 200 }),
    });
    show();
    fireEvent.click(within(await screen.findByTestId('recent-1')).getByRole('button', { name: 'Match to expense' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByText('Google / INV-9'));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'PUT')).toBe(true));
    const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({ expenseId: 31 });
  });

  it('says what to do when nothing is picked, and every block has an empty state', async () => {
    stub(null);
    show();
    expect(await screen.findByTestId('financy-dash-empty')).toHaveTextContent('Connect Financy and pick the business accounts to see this tab.');
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    const empty: FinancyDashboardData = {
      ...DASH,
      cashflow: DASH.cashflow.map((m) => ({ ...m, income: 0, expenses: 0 })),
      categories: { expenses: { total: 0, rows: [] }, income: { total: 0, rows: [] } },
      accounts: { checking: { totals: {}, rows: [] }, cards: { totalCurrent: 0, rows: [] } },
      recent: [],
      month: { ...DASH.month, changePct: { income: null, expenses: null, net: null } },
    };
    stub(empty);
    show();
    expect(await screen.findByText('No money in or out in these months.')).toBeInTheDocument();
    expect(screen.getByText('No rows to sort by category yet.')).toBeInTheDocument();
    expect(screen.getByText('No transactions yet.')).toBeInTheDocument();
    expect(screen.getByText('No checking account picked.')).toBeInTheDocument();
    expect(screen.getByText('No card picked.')).toBeInTheDocument();
    expect(screen.getAllByText('Nothing to compare with last month.')).toHaveLength(3);
  });

  it('renders in Hebrew, right to left', async () => {
    // The app reads the language from <html lang>, which the first-paint script sets.
    document.documentElement.lang = 'he';
    document.documentElement.dir = 'rtl';
    stub(DASH);
    show();
    expect(await screen.findByText('מצב נזיל')).toBeInTheDocument();
    expect(screen.getByText('תזרים מזומנים')).toBeInTheDocument();
    expect(within(screen.getByTestId('category-list')).getByText('העברות')).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByTestId('tile-liquidity').querySelector('.ltr-nums')).toHaveTextContent('₪16,932');
  });
});
