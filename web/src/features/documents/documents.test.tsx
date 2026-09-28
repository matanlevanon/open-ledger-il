import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '../../api/client';
import { App } from '../../App';
import { ToastProvider } from '../../components/Toast';
import { formatMinor, lineTotal, money, parseMilli, parseMinor } from './format';

const owner: Me = { email: 'owner@example.com', name: 'Sample Owner', role: 'owner', features: [], theme: null, locale: null };

type Handler = (url: URL, init: RequestInit) => unknown;
let routes: Record<string, Handler>;
let calls: { method: string; path: string; body: unknown }[];

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, 'http://localhost');
      const method = init.method ?? 'GET';
      calls.push({ method, path: url.pathname + url.search, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const handler = routes[`${method} ${url.pathname}`];
      if (!handler) return new Response(JSON.stringify({ error: { code: 'not_found', message: 'No route' } }), { status: 404 });
      return new Response(JSON.stringify(handler(url, init)), { status: 200 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <App loadMe={() => Promise.resolve(owner)} />
      </MemoryRouter>
    </ToastProvider>,
  );
}

const doc = (over: Record<string, unknown> = {}) => ({
  id: 7,
  type: 'PR',
  type_name_en: 'Payment request',
  kind: 'demand',
  number: 12,
  display_number: 'PR-0012',
  status: 'final',
  state: 'partial',
  date: '2026-10-06',
  due_date: '2026-10-20',
  client_id: 3,
  client_name_en: 'Acme Ltd',
  currency: 'USD',
  total_minor: 120000,
  total_ils_minor: null,
  fx_rate: null,
  fx_rate_date: null,
  fx_source: null,
  remaining_minor: 75000,
  paid_minor: 45000,
  overdue: false,
  notes: null,
  lang_variant: 'en',
  cancel_reason: null,
  hash: 'ab',
  ...over,
});

describe('money helpers', () => {
  it('parses and formats without floats', () => {
    expect(parseMinor('1,234.5')).toBe(123450);
    expect(parseMinor('0.07')).toBe(7);
    expect(parseMinor('1.234')).toBeNull();
    expect(parseMilli('1.5')).toBe(1500);
    expect(formatMinor(-123456)).toBe('-1,234.56');
    expect(money(-5000, 'USD')).toBe('-$50.00');
    expect(lineTotal(333, 1000)).toBe(333);
    expect(lineTotal(1500, 3333)).toBe(5000);
  });
});

describe('income screens', () => {
  it('replaces the placeholders with the R01 screens', async () => {
    routes['GET /api/documents'] = () => ({ items: [], summary: { overdue: {}, due_soon: {}, open: {} } });
    renderAt('/income/quotes');
    expect(await screen.findByRole('heading', { name: 'Quotes' })).toBeInTheDocument();
    expect(screen.queryByText(/Coming in/)).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Unpaid' })).toBeNull();
  });

  it('lists payment requests with Unpaid, Draft and All tabs and a summary strip', async () => {
    routes['GET /api/documents'] = () => ({
      items: [doc({ overdue: true })],
      summary: { overdue: { USD: 75000 }, due_soon: {}, open: { USD: 75000 } },
    });
    renderAt('/income/payment-requests');
    expect(await screen.findByText('PR-0012')).toBeInTheDocument();
    expect(screen.getByText('Overdue', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getAllByText('$750.00').length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.path.startsWith('/api/documents')).at(-1)?.path).toBe('/api/documents?tab=unpaid&type=PR');
    fireEvent.click(screen.getByRole('tab', { name: 'Draft' }));
    await waitFor(() => expect(calls.at(-1)?.path).toBe('/api/documents?tab=draft&type=PR'));
    expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();
  });

  it('the editor totals lines and sends integers in minor units', async () => {
    routes['GET /api/clients'] = () => ({ clients: [{ id: 3, name_en: 'Acme Ltd', currency: 'USD', client_copy_lang: 'en' }] });
    routes['POST /api/documents'] = () => ({ document: doc({ id: 9, status: 'draft' }), lines: [], payments: [], meta: null, source: null, links: { outgoing: [], incoming: [] }, events: [] });
    routes['POST /api/documents/9/finalize'] = () => ({ document: doc({ id: 9 }) });
    routes['GET /api/documents/9'] = () => ({ document: doc({ id: 9 }), lines: [], payments: [], meta: null, source: null, links: { outgoing: [], incoming: [] }, events: [] });
    renderAt('/income/payment-requests/new?client=3');
    await screen.findByRole('option', { name: 'Acme Ltd' });
    fireEvent.change(screen.getByLabelText('Item 1'), { target: { value: 'Growth audit' } });
    fireEvent.change(screen.getByLabelText('Quantity 1'), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText('Price 1'), { target: { value: '1,000' } });
    await waitFor(() => expect(screen.getByTestId('editor-total')).toHaveTextContent('$1,500.00'));
    fireEvent.click(screen.getByRole('button', { name: 'Save and finalize' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/documents/9/finalize')).toBe(true));
    const created = calls.find((c) => c.method === 'POST' && c.path === '/api/documents');
    expect(created?.body).toMatchObject({
      type: 'PR',
      clientId: 3,
      currency: 'USD',
      lines: [{ description: 'Growth audit', quantityMilli: 1500, unitPriceMinor: 100000 }],
      payments: [],
    });
  });

  it('asks before issuing a document to a not-active client, and can make it active', async () => {
    routes['GET /api/clients'] = () => ({ clients: [{ id: 3, name_en: 'Acme Ltd', currency: 'USD', client_copy_lang: 'en', active: 0 }] });
    routes['POST /api/clients/3/activate'] = () => ({ client: { id: 3, active: 1 } });
    routes['POST /api/documents'] = () => ({ document: doc({ id: 9, status: 'draft' }), lines: [], payments: [], meta: null, source: null, links: { outgoing: [], incoming: [] }, events: [] });
    routes['GET /api/documents/9'] = () => ({ document: doc({ id: 9, status: 'draft' }), lines: [], payments: [], meta: null, source: null, links: { outgoing: [], incoming: [] }, events: [] });
    renderAt('/income/payment-requests/new?client=3');
    await screen.findByRole('option', { name: 'Acme Ltd' });
    fireEvent.change(screen.getByLabelText('Item 1'), { target: { value: 'Growth audit' } });
    fireEvent.change(screen.getByLabelText('Price 1'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Acme Ltd is marked not active');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/documents')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Make active' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/documents')).toBe(true));
    expect(calls.some((c) => c.path === '/api/clients/3/activate')).toBe(true);
  });

  it('shows the document as a timeline and records a payment', async () => {
    routes['GET /api/documents/7'] = () => ({
      document: doc(),
      lines: [{ id: 1, position: 1, description_en: 'Strategy', description_he: null, quantity_milli: 2000, unit_price_minor: 60000, discount_minor: 0, line_total_minor: 120000 }],
      payments: [],
      meta: null,
      source: null,
      links: { outgoing: [{ id: 1, kind: 'payment', amount_minor: 45000, currency: 'USD', other_id: 8, other_type: '400', other_status: 'final', other_display_number: '400-0003' }], incoming: [] },
      events: [
        { id: 1, kind: 'created', at: '2026-10-06T08:00:00Z', user_email: null, details: null },
        { id: 2, kind: 'finalized', at: '2026-10-06T08:01:00Z', user_email: null, details: { label: 'PR-0012' } },
      ],
    });
    routes['POST /api/documents/7/record-payment'] = () => ({ document: doc({ id: 8, type: '400', kind: 'receipt' }) });
    routes['GET /api/documents/8'] = () => ({ document: doc({ id: 8, type: '400', kind: 'receipt', display_number: '400-0004' }), lines: [], payments: [], meta: null, source: null, links: { outgoing: [], incoming: [] }, events: [] });
    renderAt('/income/documents/7');
    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    for (const step of ['Create', 'Send', 'Payments', 'Cancel']) {
      expect(within(timeline).getByRole('heading', { name: step })).toBeInTheDocument();
    }
    expect(screen.getByText('400-0003')).toBeInTheDocument();
    expect(screen.getByText('Finalized as PR-0012')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount in USD')).toHaveValue('750.00');
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/documents/7/record-payment')).toBe(true));
    const body = calls.find((c) => c.path === '/api/documents/7/record-payment')!.body as { payments: { amountMinor: number }[] };
    expect(body.payments[0]!.amountMinor).toBe(75000);
    expect(await screen.findByRole('heading', { name: '400-0004' })).toBeInTheDocument();
  });
});

describe('client screens', () => {
  it('lists clients with balances per currency', async () => {
    routes['GET /api/clients'] = () => ({
      clients: [{ id: 3, name_en: 'Acme Ltd', name_he: 'אקמה', country: 'GB', currency: 'USD', archived_at: null, balances: { USD: 75000, EUR: 5000 }, overdue: {} }],
    });
    renderAt('/clients');
    const main = within(screen.getByRole('main'));
    expect(await main.findByRole('link', { name: 'Acme Ltd' })).toHaveAttribute('href', '/clients/3');
    expect(main.getByText('$750.00 · €50.00')).toBeInTheDocument();
  });

  it('shows the client ledger with a running balance', async () => {
    routes['GET /api/clients/3'] = () => ({
      client: { id: 3, name_en: 'Acme Ltd', name_he: null, country: 'IL', currency: 'ILS', client_copy_lang: 'en', archived_at: null, foreign_resident: 0 },
      contacts: [],
      balances: { ILS: 60000 },
      consent: { status: 'none', at: null, method: null, source: null },
    });
    routes['GET /api/clients/3/ledger'] = () => ({
      client: { id: 3, name_en: 'Acme Ltd', name_he: null },
      from: null,
      to: null,
      opening: {},
      closing: { ILS: 60000 },
      entries: [
        { kind: 'document', date: '2026-10-06', document_id: 7, type: 'PR', display_number: 'PR-0001', status: 'final', description: 'Payment request', currency: 'ILS', debit_minor: 100000, credit_minor: 0, balance_minor: 100000 },
        { kind: 'payment', date: '2026-10-08', document_id: 8, type: '400', display_number: '400-0001', status: 'final', description: 'Payment by bank transfer', currency: 'ILS', debit_minor: 0, credit_minor: 40000, balance_minor: 60000, paid_on: '2026-10-08' },
      ],
    });
    renderAt('/clients/3');
    fireEvent.click(await screen.findByRole('tab', { name: 'Ledger' }));
    expect(await screen.findByText('PR-0001')).toBeInTheDocument();
    expect(screen.getByText('₪400.00')).toBeInTheDocument();
    expect(screen.getAllByText('₪600.00').length).toBeGreaterThan(0);
  });

  /** R18 task 7: "New document" offers every type the current legal mode allows, preselecting this client. */
  it('offers a New document dropdown matching Create new, hiding disabled types, preselecting the client', async () => {
    routes['GET /api/clients/3'] = () => ({
      client: { id: 3, name_en: 'Acme Ltd', name_he: null, country: 'IL', currency: 'ILS', client_copy_lang: 'en', archived_at: null, active: 1, foreign_resident: 0 },
      contacts: [],
      balances: {},
      consent: { status: 'none', at: null, method: null, source: null },
    });
    routes['GET /api/documents/types'] = () => ({
      types: [
        { code: 'QT', name_en: 'Quote', name_he: 'הצעת מחיר', kind: 'quote', enabled: 1 },
        { code: 'PR', name_en: 'Payment Request', name_he: 'דרישת תשלום', kind: 'demand', enabled: 1 },
        // R18 task 10: PF is disabled (merged into 300); 300 is the one proforma type now.
        { code: 'PF', name_en: 'Pro Forma Invoice', name_he: 'חשבון עסקה', kind: 'demand', enabled: 0 },
        { code: '300', name_en: 'Pro Forma Invoice', name_he: 'חשבון עסקה', kind: 'demand', enabled: 1 },
        { code: '400', name_en: 'Receipt', name_he: 'קבלה', kind: 'receipt', enabled: 1 },
        { code: '405', name_en: 'Credit', name_he: 'מסמך זיכוי', kind: 'credit', enabled: 1 },
        { code: '305', name_en: 'Invoice', name_he: 'חשבונית מס', kind: 'invoice', enabled: 0 },
        { code: '320', name_en: 'Invoice / Receipt', name_he: 'חשבונית מס קבלה', kind: 'invoice_receipt', enabled: 0 },
      ],
    });
    renderAt('/clients/3');
    fireEvent.click(await screen.findByRole('button', { name: 'New document' }));
    expect(screen.getByRole('menuitem', { name: 'quote' })).toHaveAttribute('href', '/income/quotes/new?client=3');
    expect(screen.getByRole('menuitem', { name: 'payment request' })).toHaveAttribute('href', '/income/payment-requests/new?client=3');
    expect(screen.getByRole('menuitem', { name: 'pro forma invoice' })).toHaveAttribute('href', '/income/proformas/new?client=3');
    expect(screen.getByRole('menuitem', { name: 'receipt' })).toHaveAttribute('href', '/income/documents/new?type=400&client=3');
    // Credit (405) is offered, same as the sidebar's Create new.
    expect(screen.getByRole('menuitem', { name: 'credit' })).toHaveAttribute('href', '/income/documents/new?type=405&client=3');
    // Not offered: PF (disabled, merged into 300) and a not-yet-enabled murshe type (305/320).
    expect(screen.getAllByRole('menuitem')).toHaveLength(5);
    expect(screen.queryByRole('menuitem', { name: /invoice \/ receipt/ })).not.toBeInTheDocument();
  });

  /** After the legal-mode switch, 305/320 become enabled and join the dropdown. */
  it('offers invoice and invoice/receipt once the legal mode allows them', async () => {
    routes['GET /api/clients/3'] = () => ({
      client: { id: 3, name_en: 'Acme Ltd', name_he: null, country: 'IL', currency: 'ILS', client_copy_lang: 'en', archived_at: null, active: 1, foreign_resident: 0 },
      contacts: [],
      balances: {},
      consent: { status: 'none', at: null, method: null, source: null },
    });
    routes['GET /api/documents/types'] = () => ({
      types: [
        { code: 'QT', name_en: 'Quote', name_he: 'הצעת מחיר', kind: 'quote', enabled: 1 },
        { code: '305', name_en: 'Invoice', name_he: 'חשבונית מס', kind: 'invoice', enabled: 1 },
        { code: '320', name_en: 'Invoice / Receipt', name_he: 'חשבונית מס קבלה', kind: 'invoice_receipt', enabled: 1 },
        { code: '332', name_en: 'Transaction invoice with advance approval', name_he: 'חשבון עסקה באישור מראש', kind: 'demand', enabled: 1 },
      ],
    });
    renderAt('/clients/3');
    fireEvent.click(await screen.findByRole('button', { name: 'New document' }));
    expect(screen.getByRole('menuitem', { name: 'invoice' })).toHaveAttribute('href', '/income/documents/new?type=305&client=3');
    expect(screen.getByRole('menuitem', { name: 'invoice / receipt' })).toHaveAttribute('href', '/income/documents/new?type=320&client=3');
    // 332 is its own separate flow, never offered here.
    expect(screen.queryByRole('menuitem', { name: /advance approval/ })).not.toBeInTheDocument();
  });

  /** R18 task 8: a translated label, not the raw method key. */
  it('shows a translated consent method label, not the raw key', async () => {
    routes['GET /api/clients/3'] = () => ({
      client: { id: 3, name_en: 'Acme Ltd', name_he: null, country: 'IL', currency: 'ILS', client_copy_lang: 'en', archived_at: null, active: 1, foreign_resident: 0 },
      contacts: [],
      balances: {},
      consent: { status: 'granted', at: '2026-09-25T00:00:00Z', method: 'email_link', source: null },
    });
    renderAt('/clients/3');
    expect(await screen.findByText(/by email link/)).toBeInTheDocument();
    expect(screen.queryByText(/email_link/)).not.toBeInTheDocument();
  });

  it('shows the manual-consent label with its source', async () => {
    routes['GET /api/clients/3'] = () => ({
      client: { id: 3, name_en: 'Acme Ltd', name_he: null, country: 'IL', currency: 'ILS', client_copy_lang: 'en', archived_at: null, active: 1, foreign_resident: 0 },
      contacts: [],
      balances: {},
      consent: { status: 'granted', at: '2026-09-25T00:00:00Z', method: 'manual', source: 'signed_contract' },
    });
    renderAt('/clients/3');
    expect(await screen.findByText(/manually, signed contract/)).toBeInTheDocument();
  });
});
