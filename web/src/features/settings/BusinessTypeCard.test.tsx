import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/Toast';
import type { BusinessTypeStatus } from './api';
import { BusinessTypeCard } from './BusinessTypeCard';
import { confirmMatches } from './BusinessTypeSwitchDialog';

const originalFetch = global.fetch;
const posts: { path: string; body: unknown }[] = [];

function mockFetch() {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost').pathname;
    if (init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ message: 'Switched to עוסק מורשה.', openPaymentRequests: [], repricedDrafts: [] }), { status: 200 });
    }
    if (path === '/api/ops/business') return new Response(JSON.stringify({ business: { tax_id: '515555555' } }), { status: 200 });
    throw new Error(`No mock for ${path}`);
  }) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = originalFetch;
  posts.length = 0;
});

const status = (over: Partial<BusinessTypeStatus>): BusinessTypeStatus => ({
  entityType: 'osek_patur',
  fresh: true,
  switchedOn: null,
  vatReporting: 'bimonthly',
  showCeiling: true,
  setupBusinessType: null,
  ...over,
});

function renderCard(s: BusinessTypeStatus) {
  mockFetch();
  const load = vi.fn(() => Promise.resolve(s));
  render(
    <MemoryRouter>
      <ToastProvider>
        <BusinessTypeCard load={load} />
      </ToastProvider>
    </MemoryRouter>,
  );
  return load;
}

describe('BusinessTypeCard (R24 Settings > Tax)', () => {
  it('the typed confirmation needs the exact word', () => {
    expect(confirmMatches('מורשה')).toBe(true);
    expect(confirmMatches('  מורשה ')).toBe(true);
    expect(confirmMatches('מורשה.')).toBe(false);
    expect(confirmMatches('murshe')).toBe(false);
    expect(confirmMatches('')).toBe(false);
  });

  it('עוסק פטור: Confirm stays disabled until מורשה is typed, then posts the registered switch', async () => {
    renderCard(status({}));
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to עוסק מורשה' }));
    expect(screen.getByText('Already registered as עוסק מורשה')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm switch' });
    expect(confirm).toBeDisabled();
    const word = screen.getByPlaceholderText('מורשה');
    fireEvent.change(word, { target: { value: 'מורש' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(word, { target: { value: 'מורשה' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ path: '/api/legal-mode/switch', body: { kind: 'registered' } });
    expect(await screen.findByText('Switched to עוסק מורשה.')).toBeInTheDocument();
  });

  it('after the first final document, only Becoming shows, with a start date', async () => {
    renderCard(status({ fresh: false }));
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to עוסק מורשה' }));
    expect(screen.queryByText('Already registered as עוסק מורשה')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Start date')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('מורשה'), { target: { value: 'מורשה' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm switch' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({ kind: 'becoming' });
  });

  it('עוסק מורשה and a company see the status only, with no switch', async () => {
    renderCard(status({ entityType: 'company', showCeiling: false }));
    expect(await screen.findByTestId('entity-type')).toHaveTextContent('חברה בע"מ');
    expect(await screen.findByText('Tax invoices and VAT on. ח.פ. 515555555.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch to עוסק מורשה' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('bimonthly');
  });
});
