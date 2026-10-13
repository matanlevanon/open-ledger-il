import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesProvider } from '../app/preferences';
import { ToastProvider } from './Toast';
import { ContractPage } from '../features/contracts/ContractPage';
import { ContractTemplatesTab } from '../features/contracts/ContractTemplatesTab';
import { ClientPage } from '../features/documents/Clients';
import { BackLink, contractParent, documentParent } from './BackLink';

/** R28 task 10: one shared Back link to the parent page, mirrored in Hebrew. */

let routes: Record<string, () => unknown>;

beforeEach(() => {
  routes = {
    'GET /api/me': () => ({ user: { email: 'owner@example.com', name: 'Owner', role: 'owner', features: [], theme: null, locale: null } }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url}`;
      const handler = routes[key];
      if (!handler) return new Response(JSON.stringify({ error: { code: 'not_found', message: key } }), { status: 404 });
      return new Response(JSON.stringify(handler()), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'en';
});

const wrap = (ui: React.ReactNode, path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <PreferencesProvider persist={() => undefined}>
        <ToastProvider>{ui}</ToastProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );

describe('R28 Back links', () => {
  it('goes to the parent, with the arrow pointing to the start', () => {
    wrap(<BackLink to="/expenses" />);
    const link = screen.getByTestId('back-link');
    expect(link).toHaveAttribute('href', '/expenses');
    expect(link).toHaveTextContent('←Back');
  });

  it('points the other way in Hebrew', () => {
    document.documentElement.lang = 'he';
    wrap(<BackLink to="/expenses" />);
    expect(screen.getByTestId('back-link')).toHaveTextContent('→חזרה');
  });

  it('names the parent of a document and a contract', () => {
    expect(documentParent(7)).toBe('/clients/7?tab=documents');
    expect(documentParent(null)).toBe('/income');
    expect(contractParent(7)).toBe('/clients/7?tab=contracts');
  });

  it('the contract page links back to the client Contracts tab, above the title', async () => {
    routes['GET /api/contracts/9'] = () => ({
      contract: {
        id: 9, title: 'Retainer', kind: 'contract', templateName: 'Agreement', status: 'sent', sentAt: '2026-10-12T11:00:00Z', viewedAt: null, signedAt: null,
        expiresAt: '2026-10-26T11:00:00Z', signerEmail: 'dana@acme.example', clientId: 7, clientName: 'Acme Ltd', templateId: 6, templateVersion: 1,
        includedTemplate: null, language: 'en', values: {}, signerValues: null, fields: [], signer: { name: 'Dana', email: 'dana@acme.example', phone: null },
        linkDays: 14, ownerSign: false, declineReason: null, sentSha256: 'a', signedSha256: null, identityMethod: null, linkedDocumentId: null, events: [],
      },
      currentTemplateVersion: 1,
      currentFields: [],
      emailReady: true,
      ownerSignature: false,
    });
    wrap(
      <Routes>
        <Route path="/contracts/:id" element={<ContractPage />} />
      </Routes>,
      '/contracts/9',
    );
    const title = await screen.findByRole('heading', { level: 1 });
    const back = screen.getByTestId('back-link');
    expect(back).toHaveAttribute('href', '/clients/7?tab=contracts');
    expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the client page opens the tab a Back link names', async () => {
    routes['GET /api/clients/7'] = () => ({
      client: { id: 7, name_en: 'Acme Ltd', name_he: null, country: 'IL', foreign_resident: 0, currency: 'ILS', client_copy_lang: 'en', email: null, active: 1 },
      contacts: [],
      balances: {},
      consent: { status: 'none', at: null, method: null },
      externalDocuments: [],
    });
    routes['GET /api/contracts/clients/7'] = () => ({ contracts: [] });
    wrap(
      <Routes>
        <Route path="/clients/:id" element={<ClientPage />} />
      </Routes>,
      '/clients/7?tab=contracts',
    );
    expect(await screen.findByRole('tab', { name: 'Contracts' })).toHaveAttribute('aria-selected', 'true');
  });

  it('the template editor goes back to Contract templates', async () => {
    routes['GET /api/contracts/templates'] = () => ({ templates: [{ id: 5, name: 'Work order', kind: 'work_order', version: 1, active: true, bodyEn: '', bodyHe: '', fields: [], fieldCount: 0, usedCount: 0, updatedAt: '' }] });
    routes['GET /api/contracts/services?all=1'] = () => ({ services: [] });
    wrap(<ContractTemplatesTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByTestId('template-form')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Contract templates/ }));
    expect(screen.queryByTestId('template-form')).toBeNull();
  });
});
