import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesProvider } from '../../app/preferences';
import { ToastProvider } from '../../components/Toast';
import { ClientForm } from './Clients';

/** R28: the client form switches automatic reminders and sets default payment methods. */

type Handler = (body: unknown) => unknown;
let routes: Record<string, Handler>;
const calls: { key: string; body: unknown }[] = [];

const CLIENT = {
  id: 7,
  name_en: 'Acme Ltd',
  name_he: null,
  company_id: null,
  vat_number: null,
  country: 'IL',
  foreign_resident: 0,
  currency: 'ILS',
  client_copy_lang: 'en',
  email: 'office@acme.example',
  cc_emails: null,
  phone: null,
  address_en: null,
  address_he: null,
  city: null,
  postal_code: null,
  notes: null,
  payment_instructions: null,
  payment_method_ids: null,
  archived_at: null,
  active: 1,
};
const DETAIL = (over: Record<string, unknown> = {}) => ({ client: { ...CLIENT, ...over }, contacts: [], balances: {}, consent: { status: 'none', at: null, method: null }, externalDocuments: [] });

export const METHODS = [
  { id: 1, display_name: 'Bank transfer', type: 'bank_transfer', currency: null, details: '{}', active: 1, sort_order: 1 },
  { id: 2, display_name: 'Bit', type: 'bit', currency: 'ILS', details: '{}', active: 1, sort_order: 2 },
];

beforeEach(() => {
  calls.length = 0;
  routes = {
    'GET /api/payment-methods?active=1': () => ({ paymentMethods: METHODS }),
    'POST /api/clients': () => DETAIL(),
    'PATCH /api/clients/7': () => DETAIL(),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ key, body });
      const handler = routes[key];
      if (!handler) return new Response(JSON.stringify({ error: { code: 'not_found', message: key } }), { status: 404 });
      return new Response(JSON.stringify(handler(body)), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrap(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PreferencesProvider persist={() => undefined}>
        <ToastProvider>
          <Routes>
            <Route path="/clients/new" element={<ClientForm />} />
            <Route path="/clients/:id/edit" element={<ClientForm />} />
            <Route path="/clients/:id" element={<p>Client page</p>} />
          </Routes>
        </ToastProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
}

describe('R28 client form, default payment methods', () => {
  it('shows a checkbox per active method and saves the ticked ones', async () => {
    routes['GET /api/clients/7'] = () => DETAIL({ default_payment_method_ids: '[2,9]' });
    wrap('/clients/7/edit');
    const bit = await screen.findByRole('checkbox', { name: 'Bit' });
    expect(bit).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Bank transfer' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bank transfer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save client' }));
    await screen.findByText('Client page');
    // Method 9 is not active any more, so it is dropped.
    expect((calls.find((c) => c.key === 'PATCH /api/clients/7')!.body as any).defaultPaymentMethodIds).toEqual([2, 1]);
  });

  it('a new client starts with none ticked', async () => {
    wrap('/clients/new');
    expect(await screen.findByRole('checkbox', { name: 'Bit' })).not.toBeChecked();
    expect(screen.getByText(/None ticked keeps the methods last used/)).toBeInTheDocument();
  });
});

describe('R28 client form, automatic reminders', () => {
  it('a new client sends automatic reminders by default, and the owner can turn them off', async () => {
    wrap('/clients/new');
    const box = await screen.findByRole('checkbox', { name: 'Send automatic reminders to this client' });
    expect(box).toBeChecked();
    fireEvent.change(screen.getByLabelText('Name in English'), { target: { value: 'Quiet Ltd' } });
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Save client' }));
    await screen.findByText('Client page');
    expect((calls.find((c) => c.key === 'POST /api/clients')!.body as any).autoReminders).toBe(false);
  });

  it('an existing client with reminders off shows the box unticked', async () => {
    routes['GET /api/clients/7'] = () => DETAIL({ auto_reminders: 0 });
    wrap('/clients/7/edit');
    expect(await screen.findByRole('checkbox', { name: 'Send automatic reminders to this client' })).not.toBeChecked();
  });
});

describe('R45 client form, group', () => {
  it('shows the client group, suggests existing groups and saves a new one', async () => {
    routes['GET /api/clients/7'] = () => DETAIL({ client_group: 'Open Ledger' });
    routes['GET /api/clients/groups'] = () => ({ groups: [{ name: 'Open Ledger', count: 3 }, { name: 'Consulting', count: 2 }] });
    const { container } = wrap('/clients/7/edit');
    const box = (await screen.findByRole('combobox', { name: /^Group/ })) as HTMLInputElement;
    expect(box.value).toBe('Open Ledger');
    await waitFor(() => expect(container.querySelectorAll('#client-groups option')).toHaveLength(2));
    fireEvent.change(box, { target: { value: 'Consulting' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save client' }));
    await screen.findByText('Client page');
    expect((calls.find((c) => c.key === 'PATCH /api/clients/7')!.body as any).group).toBe('Consulting');
  });
});
