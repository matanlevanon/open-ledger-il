import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreferencesProvider } from '../../app/preferences';
import { ToastProvider } from '../../components/Toast';
import { type BusinessCategory, ExpenseCategoriesSection } from './ExpenseCategoriesSection';

const LIST: BusinessCategory[] = [
  { id: 1, key: 'rent', name_en: 'Rent', name_he: null, sort_order: 1, hidden: 0, own: 0 },
  { id: 2, key: 'travel', name_en: 'Travel', name_he: null, sort_order: 2, hidden: 0, own: 0 },
];

describe('R48 expense categories of this business', () => {
  it('hides a category, shows the error for one in use, and adds an own one', async () => {
    const api = {
      list: vi.fn(async () => LIST),
      change: vi.fn(async (key: string) => {
        if (key === 'rent') throw new Error('3 expenses use this category. Move them to another category first.');
        return LIST.map((c) => (c.key === key ? { ...c, hidden: 1 } : c));
      }),
      add: vi.fn(async (nameEn: string) => [...LIST, { id: 3, key: 'b2:x', name_en: nameEn, name_he: null, sort_order: 3, hidden: 0, own: 1 }]),
    };
    render(
      <PreferencesProvider persist={() => undefined}>
        <ToastProvider>
          <ExpenseCategoriesSection api={api} />
        </ToastProvider>
      </PreferencesProvider>,
    );
    const hide = await screen.findAllByRole('button', { name: 'Hide' });
    fireEvent.click(hide[0]!);
    expect(await screen.findByText(/3 expenses use this category/)).toBeTruthy();
    fireEvent.click(hide[1]!);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Show' })).toHaveLength(1));
    fireEvent.change(screen.getByRole('textbox', { name: 'New category' }), { target: { value: 'Film stock' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.add).toHaveBeenCalledWith('Film stock'));
  });
});
