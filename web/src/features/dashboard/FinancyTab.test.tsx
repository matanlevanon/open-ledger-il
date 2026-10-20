import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DashboardData } from '../../api/dashboard';
import { dashboardFixture } from '../../api/fixtures/dashboard';
import { DashboardPage } from './DashboardPage';

/** R42 task 1: the Dashboard and Financy Dashboard tabs, and the ?view=financy address. */

const data = (financyTab: boolean): DashboardData => ({ ...structuredClone(dashboardFixture), financyTab });

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{`${loc.pathname}${loc.search}`}</p>;
}

function renderAt(path: string, financyTab: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/financy/dashboard')) return new Response(JSON.stringify({ dashboard: null }), { status: 200 });
      throw new Error(`No mock for ${String(input)}`);
    }),
  );
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DashboardPage loadDashboard={() => Promise.resolve(data(financyTab))} today="2026-09-28" />
      <Where />
    </MemoryRouter>,
  );
}

describe('Dashboard tabs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows no tabs when Financy is not connected or nothing is picked, even at ?view=financy', async () => {
    renderAt('/?view=financy', false);
    expect(await screen.findByRole('link', { name: 'New quote' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByTestId('financy-dash-empty')).toBeNull();
  });

  it('opens the Financy Dashboard tab from the address, and the Dashboard tab goes back', async () => {
    renderAt('/?view=financy', true);
    const financy = await screen.findByRole('tab', { name: 'Financy Dashboard' });
    expect(financy).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('financy-dash-empty')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New quote' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Customize dashboard' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
    expect(await screen.findByRole('link', { name: 'New quote' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Financy Dashboard' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/?view=financy');
  });

  it('the main tab keeps Customize dashboard and has no Bank card', async () => {
    renderAt('/', true);
    expect(await screen.findByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('link', { name: 'Customize dashboard' })).toBeInTheDocument();
    expect(screen.queryByTestId('bank-card')).toBeNull();
  });
});
