import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardData, DashboardQuery } from '../../api/dashboard';
import { dashboardFixture } from '../../api/fixtures/dashboard';
import { DashboardPage } from './DashboardPage';

const TODAY = '2026-09-28';
const data = (): DashboardData => structuredClone(dashboardFixture);

function renderPage(loadDashboard: (q: DashboardQuery) => Promise<DashboardData> = () => Promise.resolve(data())) {
  return render(
    <MemoryRouter>
      <DashboardPage loadDashboard={loadDashboard} today={TODAY} />
    </MemoryRouter>,
  );
}

const card = (id: string) => document.querySelector<HTMLElement>(`[data-card="${id}"]`)!;

describe('DashboardPage', () => {
  beforeEach(() => localStorage.clear());

  it('offers the four quick-action tiles', () => {
    renderPage();
    for (const label of ['New quote', 'New payment request', 'Record payment', 'Upload expense']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('lists overdue requests and open pro formas with client, amount and age', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Overdue and open' });
    const overdue = card('overdue');
    expect(within(overdue).getByText('2 requests')).toBeInTheDocument();
    expect(within(overdue).getByRole('link', { name: 'Payment Request PR-0041' })).toHaveAttribute('href', '/income/documents/41');
    expect(within(overdue).getAllByText('Acme Ltd').length).toBeGreaterThan(0);
    expect(within(overdue).getByText('75 days late')).toBeInTheDocument();
    expect(within(overdue).getByText('Not due yet')).toBeInTheDocument();
  });

  it('shows an empty state when nothing is overdue or open', async () => {
    const d = data();
    d.cards.overdue = { items: [], overdueRequests: [], openProformas: [] };
    renderPage(() => Promise.resolve(d));
    expect(await screen.findByText('Nothing overdue')).toBeInTheDocument();
  });

  it('puts the numbers under each chart, with a total', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Income by month' });
    const income = card('incomeByMonth');
    expect(within(income).getByRole('table')).toBeInTheDocument();
    expect(within(income).getAllByText('₪92,100.00').length).toBeGreaterThan(0);
  });

  it('shows top clients with Other and marks an imported client', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Top clients' });
    const clients = card('topClients');
    expect(within(clients).getByText('Other')).toBeInTheDocument();
    expect(within(clients).getByText('Imported')).toBeInTheDocument();
    expect(within(clients).getByText('$6,040.00')).toBeInTheDocument();
  });

  it('compares the previous year, the same period last year and this year to date', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Year comparison' });
    const years = card('yearComparison');
    expect(within(years).getByText('2025 same period')).toBeInTheDocument();
    expect(within(years).getByText('2026 to date')).toBeInTheDocument();
    expect(within(years).getByText('+56%')).toBeInTheDocument();
  });

  it('links each aging bucket to the filtered report', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Receivables aging' });
    const link = within(card('aging')).getByRole('link', { name: /61 to 90 days/ });
    expect(link).toHaveAttribute('href', '/reports?report=aged-receivables&bucket=61-90');
  });

  it('gives each card a View report link carrying its period', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Cash flow' });
    const link = within(card('cashFlow')).getByRole('link', { name: 'View report' });
    expect(link).toHaveAttribute('href', '/reports?report=cash-flow&from=2025-10-01&to=2026-09-28');
  });

  it('shows the ceiling meter, the VAT card and the ITA status', async () => {
    renderPage();
    expect(await screen.findByTestId('ceiling-percent')).toHaveTextContent('68%');
    expect(screen.getByText('No VAT yet')).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });

  it('shows only the visible cards, in the stored order', async () => {
    const d = data();
    d.layout = [
      { id: 'aging', visible: true },
      { id: 'cashFlow', visible: true },
      { id: 'overdue', visible: false },
      { id: 'quickActions', visible: false },
    ];
    renderPage(() => Promise.resolve(d));
    await screen.findByRole('heading', { name: 'Receivables aging' });
    const order = [...document.querySelectorAll('[data-card]')].map((el) => el.getAttribute('data-card'));
    expect(order).toEqual(['aging', 'cashFlow']);
    expect(screen.queryByText('Overdue and open')).not.toBeInTheDocument();
  });

  it('refetches only the card whose period changes', async () => {
    const load = vi.fn((q: DashboardQuery) => Promise.resolve(q.cards ? { ...data(), cards: { cashFlow: { ...data().cards.cashFlow!, from: '2024-10-01' } } } : data()));
    renderPage(load);
    await screen.findByRole('heading', { name: 'Cash flow' });
    fireEvent.change(screen.getByLabelText('Period: Cash flow'), { target: { value: 'last24' } });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load.mock.calls[1]![0]).toEqual({ cards: ['cashFlow'], ranges: { cashFlow: { from: '2024-10-01', to: TODAY } } });
    expect(load.mock.calls[0]![0].ranges?.cashFlow).toEqual({ from: '2025-10-01', to: TODAY });
  });

  it('shows an error message when the load fails', async () => {
    renderPage(() => Promise.reject(new Error('boom')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the dashboard.');
  });
});
