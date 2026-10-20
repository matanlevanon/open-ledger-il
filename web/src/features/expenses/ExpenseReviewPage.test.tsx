import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/Toast';
import { ExpenseReviewPage } from './ExpenseReviewPage';

/** R39: the "Not read automatically" notice and Read again. */

const UNREAD = {
  id: 5,
  file_id: 9,
  supplier_id: null,
  category_id: null,
  status: 'new',
  status_reason: null,
  duplicate_of_id: null,
  document_number: null,
  document_date: '2026-10-20',
  document_type: null,
  currency: 'ILS',
  amount_minor: 0,
  vat_amount_minor: 0,
  amount_ils_minor: null,
  fx_rate: null,
  fx_source: null,
  notes: 'Not read automatically: Gemini is busy right now (HTTP 503). High demand.',
  read_status: 'failed',
  read_attempts: 1,
  read_error: 'Gemini is busy right now (HTTP 503). High demand.',
  created_at: '2026-10-20T08:00:00Z',
};

function stubFetch(readReply: () => Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (method === 'POST' && url.endsWith('/api/expenses/5/read')) return readReply();
    if (url.endsWith('/expenses/categories')) return ok({ categories: [] });
    if (url.endsWith('/expenses/suppliers')) return ok({ suppliers: [{ id: 3, name: 'Read Co' }] });
    if (url.endsWith('/expenses/5')) return ok({ expense: UNREAD });
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/expenses/5']}>
        <Routes>
          <Route path="/expenses/:id" element={<ExpenseReviewPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('ExpenseReviewPage: an expense not read automatically', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the reason and a Read again button', async () => {
    stubFetch(async () => new Response('{}'));
    renderPage();
    const notice = await screen.findByTestId('not-read-notice');
    expect(within(notice).getByText('Not read automatically: Gemini is busy right now (HTTP 503). High demand.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read again' })).toBeEnabled();
  });

  it('reads, fills the fields and says to check them', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    stubFetch(async () => {
      await gate;
      const read = { ...UNREAD, supplier_id: 3, amount_minor: 23600, vat_amount_minor: 3600, document_number: 'RR-1', notes: null, read_status: 'read', read_error: null, read_attempts: 2 };
      return new Response(JSON.stringify({ expense: read, read: true, message: null }), { status: 200 });
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Read again' }));
    const busy = await screen.findByRole('button', { name: 'Reading…' });
    expect(busy).toBeDisabled();
    release();
    expect(await screen.findByText('Read. Check the fields.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('236.00')).toBeInTheDocument();
    expect(screen.getByDisplayValue('RR-1')).toBeInTheDocument();
    expect(screen.queryByTestId('not-read-notice')).not.toBeInTheDocument();
  });

  it('a failed read shows the new reason and keeps the button', async () => {
    stubFetch(async () => {
      const failed = { ...UNREAD, read_attempts: 2, read_error: 'Anthropic is busy right now (HTTP 529). Overloaded', notes: 'Not read automatically: Anthropic is busy right now (HTTP 529). Overloaded' };
      return new Response(JSON.stringify({ expense: failed, read: false, message: failed.read_error }), { status: 200 });
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Read again' }));
    const notice = screen.getByTestId('not-read-notice');
    expect(await within(notice).findByText('Not read automatically: Anthropic is busy right now (HTTP 529). Overloaded')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toHaveValue('Not read automatically: Anthropic is busy right now (HTTP 529). Overloaded');
    expect(screen.getByRole('button', { name: 'Read again' })).toBeEnabled();
  });

  it('shows the server reason when reading is refused', async () => {
    stubFetch(async () => new Response(JSON.stringify({ error: { code: 'no_reader', message: 'No AI key is set. Add one in Settings, or type the fields.' } }), { status: 409 }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Read again' }));
    expect(await screen.findByText('No AI key is set. Add one in Settings, or type the fields.')).toBeInTheDocument();
  });
});
