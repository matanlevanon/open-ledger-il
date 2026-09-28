import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesProvider } from '../app/preferences';
import { Sidebar } from './Sidebar';

const CLIENTS = [
  { id: 1, name_en: 'Zeta Corp', name_he: null, active: 1 },
  { id: 2, name_en: 'Alpha Inc', name_he: null, active: 1 },
  { id: 3, name_en: 'Old Client', name_he: null, active: 0 },
];

/** Today's עוסק פטור order (migrations/0100_documents.sql's sort_order): 305 and 320 disabled. */
const TYPES_PATUR = [
  { code: 'QT', name_en: 'Quote', name_he: 'הצעת מחיר', kind: 'quote', enabled: 1 },
  { code: 'PR', name_en: 'Payment Request', name_he: 'דרישת תשלום', kind: 'demand', enabled: 1 },
  { code: 'PF', name_en: 'Pro Forma Invoice', name_he: 'חשבון עסקה', kind: 'demand', enabled: 0 },
  { code: '300', name_en: 'Pro Forma Invoice', name_he: 'חשבון עסקה', kind: 'demand', enabled: 1 },
  { code: '400', name_en: 'Receipt', name_he: 'קבלה', kind: 'receipt', enabled: 1 },
  { code: '405', name_en: 'Credit', name_he: 'מסמך זיכוי', kind: 'credit', enabled: 1 },
  { code: '305', name_en: 'Invoice', name_he: 'חשבונית מס', kind: 'invoice', enabled: 0 },
  { code: '320', name_en: 'Invoice / Receipt', name_he: 'חשבונית מס קבלה', kind: 'invoice_receipt', enabled: 0 },
  { code: '330', name_en: 'Credit Invoice', name_he: 'חשבונית מס זיכוי', kind: 'credit_invoice', enabled: 0 },
  { code: '332', name_en: 'Transaction invoice with advance approval', name_he: 'חשבון עסקה באישור מראש', kind: 'demand', enabled: 0 },
];

/** After the legal-mode switch (migrations/1900_document_types_sort_order.sql): 320 then 305 sort first. */
const TYPES_MURSHE = TYPES_PATUR.map((ty) => (ty.code === '305' || ty.code === '320' ? { ...ty, enabled: 1 } : ty)).sort(
  (a, b) => (a.code === '320' ? -2 : a.code === '305' ? -1 : 0) - (b.code === '320' ? -2 : b.code === '305' ? -1 : 0),
);

let documentTypes = TYPES_PATUR;

beforeEach(() => {
  localStorage.clear();
  documentTypes = TYPES_PATUR;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost');
      if (url.pathname === '/api/clients') return new Response(JSON.stringify({ clients: CLIENTS }), { status: 200 });
      if (url.pathname === '/api/documents/types') return new Response(JSON.stringify({ types: documentTypes }), { status: 200 });
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'No route' } }), { status: 404 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderSidebar(path = '/clients', email = 'owner@example.com') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PreferencesProvider persist={() => undefined}>
        <Sidebar role="owner" features={['clients']} email={email} />
      </PreferencesProvider>
    </MemoryRouter>,
  );
}

/** R18 task 5: Clients in the sidebar, directly below Dashboard, expanding in place. */
describe('Sidebar: Clients', () => {
  it('sits directly below Dashboard, outside the Income group', () => {
    renderSidebar('/');
    // First link is the app name/logo; the nav proper starts right after it.
    const labels = screen.getAllByRole('link').map((el) => el.textContent);
    const navLabels = labels.slice(1);
    expect(navLabels[0]).toBe('Dashboard');
    expect(navLabels[1]).toBe('Clients');
  });

  it('is collapsed (no groups) off a clients route', () => {
    renderSidebar('/');
    expect(screen.queryByText('Active (2)')).not.toBeInTheDocument();
  });

  it('expands into Active and Not active groups, sorted A-Z, on the clients list route', async () => {
    renderSidebar('/clients');
    await waitFor(() => expect(screen.getByText('Active (2)')).toBeInTheDocument());
    expect(screen.getByText('Not active (1)')).toBeInTheDocument();
    // Active starts expanded: both active clients show, sorted alphabetically.
    const activeLinks = [screen.getByRole('link', { name: 'Alpha Inc' }), screen.getByRole('link', { name: 'Zeta Corp' })];
    const positions = activeLinks.map((el) => Array.from(el.parentElement!.parentElement!.children).indexOf(el.parentElement!));
    expect(positions[0]!).toBeLessThan(positions[1]!);
    // Not active starts collapsed.
    expect(screen.queryByRole('link', { name: 'Old Client' })).not.toBeInTheDocument();
  });

  it('also expands on a single client route, and highlights that client', async () => {
    renderSidebar('/clients/2');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Alpha Inc' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Alpha Inc' })).toHaveClass('bg-band');
  });

  it('filters both groups by name', async () => {
    renderSidebar('/clients');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Alpha Inc' })).toBeInTheDocument());
    fireEvent.click(screen.getByText('Not active (1)'));
    fireEvent.change(screen.getByPlaceholderText('Filter clients'), { target: { value: 'old' } });
    expect(screen.queryByRole('link', { name: 'Alpha Inc' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Old Client' })).toBeInTheDocument();
  });

  it('remembers a group toggle across remounts, per user', async () => {
    const first = renderSidebar('/clients');
    await waitFor(() => expect(screen.getByText('Not active (1)')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Not active (1)'));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Old Client' })).toBeInTheDocument());
    first.unmount();

    renderSidebar('/clients');
    await waitFor(() => expect(screen.getByRole('link', { name: 'Old Client' })).toBeInTheDocument());
  });

  it('keeps each user\'s toggle separate', async () => {
    const first = renderSidebar('/clients', 'owner@example.com');
    await waitFor(() => expect(screen.getByText('Not active (1)')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Not active (1)'));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Old Client' })).toBeInTheDocument());
    first.unmount();

    renderSidebar('/clients', 'accountant@example.com');
    await waitFor(() => expect(screen.getByText('Not active (1)')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'Old Client' })).not.toBeInTheDocument();
  });
});

/** R19 task 7: "Create new" follows the current legal mode, read from /api/documents/types, the same as the client page's "New document" dropdown. */
describe('Sidebar: Create new', () => {
  it('offers today\'s עוסק פטור types, in order, with no Invoice or Invoice/Receipt', async () => {
    renderSidebar('/');
    fireEvent.click(screen.getByRole('button', { name: 'Create new' }));
    await waitFor(() => expect(screen.getAllByRole('menuitem')).toHaveLength(5));
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['Quote', 'Payment Request', 'Pro Forma Invoice', 'Receipt', 'Credit']);
  });

  it('adds Invoice/Receipt and Invoice, first, once the legal mode enables them', async () => {
    documentTypes = TYPES_MURSHE;
    renderSidebar('/');
    fireEvent.click(screen.getByRole('button', { name: 'Create new' }));
    await waitFor(() => expect(screen.getAllByRole('menuitem')).toHaveLength(7));
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
      'Invoice / Receipt',
      'Invoice',
      'Quote',
      'Payment Request',
      'Pro Forma Invoice',
      'Receipt',
      'Credit',
    ]);
  });

  it('links Invoice and Invoice/Receipt to the generic document-new route with their type code', async () => {
    documentTypes = TYPES_MURSHE;
    renderSidebar('/');
    fireEvent.click(screen.getByRole('button', { name: 'Create new' }));
    expect(await screen.findByRole('menuitem', { name: 'Invoice' })).toHaveAttribute('href', '/income/documents/new?type=305');
    expect(screen.getByRole('menuitem', { name: 'Invoice / Receipt' })).toHaveAttribute('href', '/income/documents/new?type=320');
  });

  it('never offers 332 (its own separate flow) or a credit invoice (created from the invoice it credits)', async () => {
    documentTypes = TYPES_MURSHE;
    renderSidebar('/');
    fireEvent.click(screen.getByRole('button', { name: 'Create new' }));
    await waitFor(() => expect(screen.getAllByRole('menuitem')).toHaveLength(7));
    expect(screen.queryByRole('menuitem', { name: /advance approval/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Credit Invoice' })).not.toBeInTheDocument();
  });
});
