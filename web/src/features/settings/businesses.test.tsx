import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Brand, BusinessList } from '../../api/businesses';
import { PreferencesProvider } from '../../app/preferences';
import { ToastProvider } from '../../components/Toast';
import { BusinessSwitcher } from '../../layout/BusinessSwitcher';
import { canSee } from '../../layout/nav';
import { CopyToBusiness } from '../documents/Clients';
import { BrandsTab } from './BrandsTab';
import { BusinessesTab } from './BusinessesTab';

const ONE: BusinessList = {
  current: 1,
  businesses: [{ id: 1, nameEn: 'Acme', nameHe: 'אקמה', taxId: '012345678', entityType: 'osek_patur', role: 'owner' }],
  addableTypes: ['company'],
};

const TWO: BusinessList = {
  ...ONE,
  businesses: [...ONE.businesses, { id: 2, nameEn: 'Acme Ltd', nameHe: 'אקמה בע"מ', taxId: '515555555', entityType: 'company', role: 'owner' }],
};

function wrap(ui: React.ReactNode) {
  return render(
    <MemoryRouter>
      <PreferencesProvider persist={() => undefined}>
        <ToastProvider>{ui}</ToastProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
}

describe('R24 business switcher', () => {
  it('an owner with one business still sees it, with Add a business last', async () => {
    wrap(<BusinessSwitcher load={async () => ONE} onSwitch={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Business' }));
    const items = screen.getAllByRole('menuitemradio');
    expect(items).toHaveLength(1);
    const add = screen.getByRole('menuitem', { name: 'Add a business' });
    expect(add.compareDocumentPosition(items[0]!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('switches to another business', async () => {
    const onSwitch = vi.fn();
    wrap(<BusinessSwitcher load={async () => TWO} onSwitch={onSwitch} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Business' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Acme Ltd/ }));
    expect(onSwitch).toHaveBeenCalledWith(2);
  });

  it('is hidden for someone with one business who cannot add one', async () => {
    const load = vi.fn(async () => ({ ...ONE, addableTypes: [] }));
    const { container } = wrap(<BusinessSwitcher load={load} onSwitch={vi.fn()} />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(container.querySelector('[aria-haspopup="menu"]')).toBeNull();
  });
});

describe('R24 Settings > Businesses', () => {
  it('offers a company only when an עוסק business exists, says why, and needs the typed confirm', async () => {
    const create = vi.fn(async () => ({ businessId: 2 }));
    wrap(<BusinessesTab load={async () => ONE} create={create} startAdding />);
    expect(await screen.findByTestId('one-osek-note')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Business name (English)'), { target: { value: 'Acme Ltd' } });
    fireEvent.change(screen.getByLabelText('Business name (Hebrew)'), { target: { value: 'אקמה בע"מ' } });
    fireEvent.change(screen.getByLabelText(/^ח\.פ\. \(company number\)/), { target: { value: '515555555' } });
    fireEvent.change(screen.getByLabelText('Address (English)'), { target: { value: '1 Main St' } });
    const add = screen.getByRole('button', { name: 'Add business' });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('מורשה'), { target: { value: 'מורשה' } });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'company', taxId: '515555555' })));
    expect(await screen.findByRole('button', { name: 'Connect the Tax Authority for this business' })).toBeInTheDocument();
  });
});

describe('R24 Settings > Brands', () => {
  const brand: Brand = {
    id: 1, business_id: 1, name_en: '', name_he: '', tagline_en: null, tagline_he: null, email: null, phone: null,
    website: null, address_en: null, address_he: null, is_default: 1, active: 1,
  };

  it('lists the default brand and adds a new one', async () => {
    const create = vi.fn(async () => ({ brands: [brand, { ...brand, id: 2, name_en: 'Studio', is_default: 0 }] }));
    wrap(<BrandsTab load={async () => ({ brands: [brand] })} create={create} update={vi.fn()} />);
    expect(await screen.findByText('Same as the business')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a brand' }));
    fireEvent.change(screen.getByLabelText('Business name (English)'), { target: { value: 'Studio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save brand' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ nameEn: 'Studio', email: null })));
    expect(await screen.findByText('Studio')).toBeInTheDocument();
  });
});

describe('R24 assistant navigation', () => {
  it('sees the dashboard and its feature areas, never Settings', () => {
    const features = ['clients', 'issue_documents'];
    expect(canSee({ path: '/' }, 'assistant', features)).toBe(true);
    expect(canSee({ path: '/settings' }, 'assistant', features)).toBe(false);
    expect(canSee({ path: '/clients', feature: 'clients' }, 'assistant', features)).toBe(true);
    expect(canSee({ path: '/reports', feature: 'reports' }, 'assistant', features)).toBe(false);
  });
});

describe('R24 B5 copy a client to another business', () => {
  it('posts one client to the chosen business', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ clientId: 9, businessId: 2 }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    wrap(<CopyToBusiness clientId={5} load={async () => TWO} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy to business' }));
    await screen.findByText(/Copied/);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/clients/5/copy-to-business');
    expect(JSON.parse(String(init.body))).toEqual({ businessId: 2 });
    vi.unstubAllGlobals();
  });

  it('is hidden with one business', async () => {
    const load = vi.fn(async () => ONE);
    wrap(<CopyToBusiness clientId={5} load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Copy to business' })).toBeNull();
  });
});
