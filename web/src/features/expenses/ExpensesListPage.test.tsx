import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpensesListPage } from './ExpensesListPage';

const EXPENSES = [
  {
    id: 1,
    file_id: 1,
    supplier_id: 1,
    category_id: null,
    status: 'new',
    status_reason: null,
    duplicate_of_id: null,
    document_number: 'AWS-1',
    document_date: '2026-10-03',
    document_type: 'Invoice',
    currency: 'USD',
    amount_minor: 4250,
    vat_amount_minor: 0,
    amount_ils_minor: null,
    fx_rate: null,
    fx_source: null,
    notes: null,
    created_at: '2026-10-03T00:00:00Z',
  },
];

function mockFetch(byUrl: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const match = Object.keys(byUrl).find((key) => url.includes(key));
    if (!match) throw new Error(`Unexpected fetch: ${url}`);
    return new Response(JSON.stringify(byUrl[match]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

describe('ExpensesListPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/api/expenses?status=new': { expenses: EXPENSES },
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('lists expenses awaiting review by default', async () => {
    render(
      <MemoryRouter>
        <ExpensesListPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('AWS-1')).toBeInTheDocument();
    expect(screen.getByText('USD 42.50')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'New' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows an empty state when there is nothing to review', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/api/expenses?status=new': { expenses: [] } }));
    render(
      <MemoryRouter>
        <ExpensesListPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('No expenses here yet.')).toBeInTheDocument());
  });

  it('imports a month and shows the summary with each skip linked to its expense', async () => {
    const summary = {
      runId: 3,
      yearMonth: '2026-08',
      trigger: 'manual',
      source: 'sheet',
      startedAt: '2026-09-28T08:00:00.000Z',
      finishedAt: '2026-09-28T08:00:05.000Z',
      filesSeen: 3,
      created: 1,
      skippedDuplicate: 1,
      skippedNotExpense: 1,
      skippedIssuedBySelf: 0,
      errors: 0,
      statusCounts: { הוצאה: 2, 'נדחה הכנסה': 1 },
      createdIds: [9],
      skips: [{ ref: 'Row 3: Gpuhost GH-0928', reason: 'supplier_number', expenseId: 1 }],
      errorList: [],
    };
    const fetchMock = mockFetch({ '/api/expenses/import/month': { summary }, '/api/expenses?status=new': { expenses: EXPENSES } });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <ExpensesListPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Month to import'), { target: { value: '2026-08' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import month' }));
    expect(await screen.findByText(/2026-08 from the index sheet: 3 seen, 1 created, 1 skipped as duplicate/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Expense 1' })).toHaveAttribute('href', '/expenses/1');
    const importCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/import/month')) as unknown as [string, RequestInit];
    expect(JSON.parse(String(importCall[1].body))).toEqual({ yearMonth: '2026-08' });
  });
});
