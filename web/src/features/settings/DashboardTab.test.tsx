import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LayoutEntry } from '../../api/dashboard';
import { ToastProvider } from '../../components/Toast';
import { DashboardTab } from './DashboardTab';

const layout: LayoutEntry[] = [
  { id: 'quickActions', visible: true },
  { id: 'overdue', visible: true },
  { id: 'cashFlow', visible: true },
];

function renderTab(save = vi.fn((cards: LayoutEntry[]) => Promise.resolve(cards))) {
  render(
    <ToastProvider>
      <DashboardTab load={() => Promise.resolve(layout)} save={save} />
    </ToastProvider>,
  );
  return save;
}

describe('Settings > Dashboard', () => {
  it('saves hidden cards and a new order', async () => {
    const save = renderTab();
    fireEvent.click(await screen.findByLabelText('Overdue and open'));
    fireEvent.click(screen.getByRole('button', { name: 'Move Cash flow up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save layout' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0]).toEqual([
      { id: 'quickActions', visible: true },
      { id: 'cashFlow', visible: true },
      { id: 'overdue', visible: false },
    ]);
  });

  it('cannot move the first card up or the last card down', async () => {
    renderTab();
    expect(await screen.findByRole('button', { name: 'Move Quick actions up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Cash flow down' })).toBeDisabled();
  });
});
