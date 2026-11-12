import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { BusinessList } from '../api/businesses';
import { PreferencesProvider } from '../app/preferences';
import { BusinessSwitcher } from './BusinessSwitcher';

/** R48 task 2: a firm with many clients. Above 8 businesses: sorted by name, tax id, search. */
function list(n: number): BusinessList {
  const names = ['Zeta', 'Alpha', 'Kappa', 'Beta', 'Omega', 'Delta', 'Gamma', 'Iota', 'Lambda', 'Epsilon'];
  return {
    current: 1,
    businesses: names.slice(0, n).map((nameEn, i) => ({
      id: i + 1,
      nameEn: `${nameEn} Ltd`,
      nameHe: '',
      taxId: `51400${String(i).padStart(4, '0')}`,
      entityType: 'company' as const,
      role: 'owner' as const,
    })),
    addableTypes: [],
  };
}

function wrap(ui: React.ReactNode) {
  return render(
    <MemoryRouter>
      <PreferencesProvider persist={() => undefined}>{ui}</PreferencesProvider>
    </MemoryRouter>,
  );
}

describe('R48 business switcher', () => {
  it('up to 8 businesses: no search, the order as served', async () => {
    wrap(<BusinessSwitcher load={async () => list(8)} onSwitch={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Business' }));
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getAllByRole('menuitemradio')[0]!.textContent).toContain('Zeta Ltd');
  });

  it('above 8: sorted by name, tax id under the name, and a search box', async () => {
    const onSwitch = vi.fn();
    wrap(<BusinessSwitcher load={async () => list(10)} onSwitch={onSwitch} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Business' }));
    const items = screen.getAllByRole('menuitemradio');
    expect(items[0]!.textContent).toContain('Alpha Ltd');
    expect(items[0]!.textContent).toContain('514000001');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search businesses' }), { target: { value: 'kap' } });
    const filtered = screen.getAllByRole('menuitemradio');
    expect(filtered).toHaveLength(1);
    fireEvent.click(filtered[0]!);
    expect(onSwitch).toHaveBeenCalledWith(3);
  });

  it('finds a business by its tax id', async () => {
    wrap(<BusinessSwitcher load={async () => list(10)} onSwitch={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Business' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '514000009' } });
    expect(screen.getAllByRole('menuitemradio').map((b) => b.textContent)).toEqual([expect.stringContaining('Epsilon Ltd')]);
  });
});
