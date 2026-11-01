import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DashboardData } from '../../api/dashboard';
import { dashboardFixture } from '../../api/fixtures/dashboard';
import { OpenItems } from './QuickPage';

const data = (): DashboardData => structuredClone(dashboardFixture);

function renderCard(load: () => Promise<DashboardData> = () => Promise.resolve(data())) {
  return render(
    <MemoryRouter>
      <OpenItems load={load} />
    </MemoryRouter>,
  );
}

describe('OpenItems on the phone home page', () => {
  beforeEach(() => localStorage.clear());

  it('shows the overdue and open documents, open by default', async () => {
    renderCard();
    expect(await screen.findByRole('link', { name: 'Payment Request PR-0041' })).toBeVisible();
    expect(document.querySelector('details')?.open).toBe(true);
  });

  it('folds and remembers that it was folded', async () => {
    const { unmount } = renderCard();
    await screen.findByRole('link', { name: 'Payment Request PR-0041' });
    const details = document.querySelector('details')!;
    details.open = false;
    fireEvent(details, new Event('toggle'));
    expect(localStorage.getItem('mtn-ledger-quick-open-items')).toBe('closed');
    unmount();
    renderCard();
    await screen.findByRole('link', { name: 'Payment Request PR-0041', hidden: true });
    expect(document.querySelector('details')?.open).toBe(false);
  });

  it('shows nothing when the business has no overdue card', async () => {
    const d = data();
    delete (d.cards as Record<string, unknown>).overdue;
    const { container } = renderCard(() => Promise.resolve(d));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('details')).toBeNull();
  });
});
