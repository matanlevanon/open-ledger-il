import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Me } from './api/client';
import { App } from './App';


const owner: Me = { email: 'owner@example.com', name: 'Sample Owner', role: 'owner', features: [], theme: null, locale: null };
const accountant: Me = {
  email: 'cpa@example.com',
  name: null,
  role: 'accountant',
  features: ['income_documents', 'expenses'],
  theme: null,
  locale: null,
};

function renderAt(path: string, me: Me = owner) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App loadMe={() => Promise.resolve(me)} />
    </MemoryRouter>,
  );
}

describe('web shell', () => {
  it('shows the sidebar sections from the UI direction', async () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const label of ['Dashboard', 'Quotes', 'Payment requests', 'Invoices and receipts', 'Recurring', 'Statements', 'Clients', 'Expenses', 'ITA', 'Reports', 'Accountant', 'Settings']) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
    expect(await screen.findByTestId('role-chip')).toHaveTextContent('owner');
  });

  it('shows the reports screen with its grouped list (R08, R21)', () => {
    renderAt('/reports');
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    const list = screen.getByRole('navigation', { name: 'Reports list' });
    expect(within(list).getByRole('link', { name: 'Income report' })).toBeInTheDocument();
    expect(within(list).getByRole('link', { name: 'Ceiling' })).toBeInTheDocument();
  });

  it('offers the פטור document types in Create new', async () => {
    // R19 task 7: Create new reads the enabled types from the API.
    const types = [
      { code: 'QT', name_en: 'Quote', name_he: 'הצעת מחיר', kind: 'quote', enabled: 1 },
      { code: 'PR', name_en: 'Payment Request', name_he: 'דרישת תשלום', kind: 'demand', enabled: 1 },
      { code: '300', name_en: 'Pro Forma Invoice', name_he: 'חשבון עסקה', kind: 'demand', enabled: 1 },
      { code: '400', name_en: 'Receipt', name_he: 'קבלה', kind: 'receipt', enabled: 1 },
      { code: '405', name_en: 'Credit', name_he: 'מסמך זיכוי', kind: 'credit', enabled: 1 },
      { code: '320', name_en: 'Invoice / Receipt', name_he: 'חשבונית מס קבלה', kind: 'invoice_receipt', enabled: 0 },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input, 'http://localhost');
        if (url.pathname === '/api/documents/types') return new Response(JSON.stringify({ types }), { status: 200 });
        return new Response(JSON.stringify({ error: { code: 'not_found', message: 'No route' } }), { status: 404 });
      }),
    );
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: 'Create new' }));
    const menu = await screen.findByRole('menu');
    const items = await within(menu).findAllByRole('menuitem');
    vi.unstubAllGlobals();
    expect(items.map((m) => m.textContent)).toEqual([
      'Quote',
      'Payment Request',
      'Pro Forma Invoice',
      'Receipt',
      'Credit',
    ]);
  });

  it('hides owner-only areas from the accountant', async () => {
    renderAt('/', accountant);
    await screen.findByText('accountant');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByText('Settings')).toBeNull();
    expect(within(nav).queryByText('ITA')).toBeNull();
    expect(within(nav).queryByText('Quotes')).toBeNull();
    expect(within(nav).getByText('Expenses')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create new' })).toBeNull();
  });

  it('shows not found for unknown paths', () => {
    renderAt('/nowhere');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
