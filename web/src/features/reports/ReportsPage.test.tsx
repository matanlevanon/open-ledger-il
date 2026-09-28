import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportResult } from '../../api/reports';
import * as api from '../../api/reports';
import { ReportsPage } from './ReportsPage';

const TODAY = '2026-09-28';

function categoryReport(from: string, to: string, ils: number): ReportResult {
  return {
    report: 'expenses-by-category',
    title: 'Expenses by category',
    from,
    to,
    columns: [
      { key: 'name', header: 'Category', kind: 'text' },
      { key: 'count', header: 'Expenses', kind: 'int', total: true },
      { key: 'original', header: 'Amount, original currency', kind: 'moneyList' },
      { key: 'ils', header: 'Amount ILS', kind: 'ils', total: true },
    ],
    rows: [
      {
        key: 'category:4',
        cells: { name: 'Software', count: 3, original: { USD: 12000 }, ils: ils },
        link: { kind: 'report', report: 'expense-items', params: { categoryId: '4', from, to } },
      },
    ],
    totals: { count: 3, ils },
  };
}

vi.mock('../../api/reports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/reports')>();
  return {
    ...actual,
    fetchIncomeReport: vi.fn().mockResolvedValue({
      from: '2026-01-01',
      to: '2026-12-31',
      rows: [{ documentId: 1, date: '2026-10-01', type: '400', typeNameEn: 'Receipt', displayNumber: '400-0001', clientId: 1, clientName: 'Acme', currency: 'ILS', amountMinor: 10000, amountIlsMinor: 10000 }],
      byMonth: [],
      byClient: [],
      byCurrency: [],
      totalIlsMinor: 10000,
    }),
    fetchCeilingMeter: vi.fn().mockResolvedValue({
      meter: { year: 2026, currency: 'ILS', limitMinor: 12283300, turnoverMinor: 8598310, openRequestsMinor: 0, currentMinor: 8598310, legalMode: 'patur', percent: 70 },
    }),
    fetchAccountantPacks: vi.fn().mockResolvedValue({ packs: [] }),
    fetchReport: vi.fn((_id: string, from: string, to: string) => Promise.resolve(categoryReport(from, to, from.startsWith('2025') ? 40000 : 50000))),
  };
});

function renderPage(path = '/reports') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ReportsPage today={TODAY} />
    </MemoryRouter>,
  );
}

describe('ReportsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.fetchReport).mockClear();
  });

  it('groups the reports list like SUMIT', () => {
    renderPage();
    const nav = screen.getByRole('navigation', { name: 'Reports list' });
    for (const group of ['Clients', 'Income', 'Expenses', 'Tax']) expect(within(nav).getByRole('heading', { name: group })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Debtors and balances' })).toHaveAttribute('href', '/reports?report=debtors');
  });

  it('opens the income report by default, with a link to each document', async () => {
    renderPage();
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '400-0001' })).toHaveAttribute('href', '/income/documents/1');
  });

  it('opens the ceiling and the monthly pack from the list', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('link', { name: 'Ceiling' }));
    expect(await screen.findByRole('meter')).toHaveAttribute('aria-valuenow', '70');
    fireEvent.click(screen.getByRole('link', { name: 'Monthly pack' }));
    expect(await screen.findByText('No pack yet')).toBeInTheDocument();
  });

  it('exports a catalog report as CSV and XLSX for the chosen period', async () => {
    renderPage('/reports?report=expenses-by-category');
    await screen.findByText('Software');
    expect(api.fetchReport).toHaveBeenCalledWith('expenses-by-category', '2026-01-01', '2026-12-31', {});
    expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute('href', '/api/reports/r/expenses-by-category/csv?from=2026-01-01&to=2026-12-31');
    expect(screen.getByRole('link', { name: 'Download XLSX' })).toHaveAttribute('href', '/api/reports/r/expenses-by-category/xlsx?from=2026-01-01&to=2026-12-31');
  });

  it('drills down from a row to the expenses behind it', async () => {
    renderPage('/reports?report=expenses-by-category');
    const link = await screen.findByRole('link', { name: 'Software' });
    expect(link).toHaveAttribute('href', '/reports?report=expense-items&categoryId=4&from=2026-01-01&to=2026-12-31');
  });

  it('takes the period and filters from a drill-down URL and shows the filter', async () => {
    renderPage('/reports?report=aged-receivables&bucket=61-90');
    await screen.findByText('Software');
    expect(api.fetchReport).toHaveBeenCalledWith('aged-receivables', expect.any(String), expect.any(String), { bucket: '61-90' });
    expect(screen.getByRole('button', { name: 'Remove the Days late filter' })).toBeInTheDocument();
    expect(screen.getByText('Open items as of today.')).toBeInTheDocument();
  });

  it('compares with the previous period', async () => {
    renderPage('/reports?report=expenses-by-category');
    await screen.findByText('Software');
    fireEvent.click(screen.getByLabelText('Compare to previous period'));
    await waitFor(() => expect(api.fetchReport).toHaveBeenCalledWith('expenses-by-category', '2025-01-01', '2025-12-31', {}));
    expect(await screen.findAllByText('+25%')).toHaveLength(2);
  });
});
