import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesProvider } from '../../app/preferences';
import { ToastProvider } from '../../components/Toast';
import type { ContractDetail, FieldDef, Service, Template } from './api';
import { ClientContracts } from './ClientContracts';
import { ContractEditor, toMinor } from './ContractEditor';
import { ContractPage, deviceOf, maskIp } from './ContractPage';
import { ContractTemplatesTab, optionsToText, textToOptions } from './ContractTemplatesTab';

const f = (over: Partial<FieldDef> & Pick<FieldDef, 'key' | 'kind'>): FieldDef => ({ labelEn: over.key, labelHe: '', required: false, options: [], multiple: false, allowOther: false, ...over });

const FIELDS: FieldDef[] = [
  f({ key: 'client_name', kind: 'client', source: 'name', labelEn: 'Client name' }),
  f({ key: 'fee', kind: 'owner_input', inputType: 'money', labelEn: 'Monthly fee' }),
  f({ key: 'start', kind: 'owner_input', inputType: 'date', labelEn: 'Start date' }),
  f({ key: 'scope', kind: 'choice', binding: 'services', multiple: true, labelEn: 'Services' }),
  f({ key: 'signer_name', kind: 'signer_input', inputType: 'name', labelEn: 'Your name' }),
  f({ key: 'client_signature', kind: 'signature', party: 'client', labelEn: 'Client signature' }),
];

const SERVICES: Service[] = [
  {
    id: 11,
    nameEn: 'Fractional CMO',
    nameHe: '',
    model: 'monthly_retainer',
    modelLabelEn: 'Monthly retainer',
    modelLabelHe: 'ריטיינר חודשי',
    descriptionEn: '',
    descriptionHe: '',
    sortOrder: 1,
    active: true,
    items: [
      { id: 101, labelEn: 'Weekly operating cadence', labelHe: '', active: true },
      { id: 102, labelEn: 'Hiring support', labelHe: '', active: true },
    ],
  },
];

const TEMPLATES: Template[] = [
  { id: 5, name: 'Work order', kind: 'work_order', version: 1, active: true, bodyEn: 'Body {{client_name}}', bodyHe: '', fields: FIELDS, fieldCount: 6, usedCount: 11, updatedAt: '' },
  { id: 6, name: 'Services agreement', kind: 'contract', version: 2, active: true, bodyEn: 'x', bodyHe: '', fields: [], fieldCount: 9, usedCount: 4, updatedAt: '' },
];

const SIGNED: ContractDetail = {
  id: 9,
  title: 'Fractional CMO, Q4 2026',
  kind: 'work_order',
  templateName: 'Work order',
  status: 'signed',
  sentAt: '2026-10-12T11:03:00Z',
  viewedAt: '2026-10-13T06:15:00Z',
  signedAt: '2026-10-13T06:18:00Z',
  expiresAt: '2026-10-26T11:03:00Z',
  signerEmail: 'dana@acme.co.il',
  clientId: 7,
  clientName: 'Acme Ltd',
  templateId: 5,
  templateVersion: 1,
  language: 'both',
  values: {},
  signerValues: { signer_name: 'Dana Cohen' },
  fields: FIELDS,
  signer: { name: 'Dana Cohen', email: 'dana@acme.co.il', phone: null },
  linkDays: 14,
  ownerSign: true,
  declineReason: null,
  sentSha256: 'a41f00',
  signedSha256: '7c0200',
  identityMethod: 'email_code',
  linkedDocumentId: null,
  events: [
    { id: 1, kind: 'created', label: 'Created by owner@example.com', actor: 'owner@example.com', role: 'owner', ip: null, userAgent: null, at: '2026-10-12T11:02:00Z' },
    { id: 2, kind: 'viewed', label: 'Opened', actor: 'dana@acme.co.il', role: 'signer', ip: '84.229.10.20', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari/604.1', at: '2026-10-13T06:15:00Z' },
    { id: 3, kind: 'signed', label: 'Signed by Dana Cohen, CEO · final hash 7c02…', actor: 'dana@acme.co.il', role: 'signer', ip: '84.229.10.20', userAgent: 'iPhone Safari', at: '2026-10-13T06:18:00Z' },
  ],
};

type Handler = (body: unknown) => unknown;
let routes: Record<string, Handler>;
const calls: { key: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  routes = {
    'GET /api/me': () => ({ user: { email: 'owner@example.com', name: 'Dana Owner', role: 'owner', features: [], theme: null, locale: null } }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const key = `${method} ${url}`;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ key, body });
      const handler = routes[key];
      if (!handler) return new Response(JSON.stringify({ error: { code: 'not_found', message: key } }), { status: 404 });
      const out = handler(body);
      if (typeof out === 'string') return new Response(out, { status: 200, headers: { 'content-type': 'text/html' } });
      return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrap(ui: React.ReactNode, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PreferencesProvider persist={() => undefined}>
        <ToastProvider>{ui}</ToastProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
}

describe('R25 Screen A, client contracts tab', () => {
  it('lists contracts with their status and reminds an unsigned one', async () => {
    routes['GET /api/contracts/clients/7'] = () => ({
      contracts: [
        { id: 9, title: 'Fractional CMO, Q4 2026', kind: 'work_order', templateName: 'Work order', status: 'signed', sentAt: '2026-10-12T11:00:00Z', viewedAt: null, signedAt: '2026-10-13T09:00:00Z', expiresAt: null, signerEmail: null },
        { id: 8, title: 'Services agreement', kind: 'contract', templateName: 'Services agreement', status: 'viewed', sentAt: '2026-10-01T11:00:00Z', viewedAt: null, signedAt: null, expiresAt: null, signerEmail: null },
      ],
    });
    routes['POST /api/contracts/8/remind'] = () => ({ url: 'u', whatsappUrl: 'w', expiresAt: '2026-10-15', emailed: true, sha256: '' });
    wrap(<ClientContracts clientId={7} canCreate />);
    expect(await screen.findByText('2 contracts')).toBeInTheDocument();
    expect(screen.getByText('Signed 13 Oct')).toBeInTheDocument();
    expect(screen.getByText('Viewed, not signed')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'New contract or work order' })).toHaveAttribute('href', '/contracts/new?clientId=7');
    fireEvent.click(screen.getByRole('button', { name: 'Remind' }));
    await screen.findByText('Reminder sent.');
    expect(calls.some((c) => c.key === 'POST /api/contracts/8/remind')).toBe(true);
  });

  it('shows no create button to an accountant', async () => {
    routes['GET /api/me'] = () => ({ user: { email: 'cpa@example.com', name: null, role: 'accountant', features: ['contracts'], theme: null, locale: null } });
    routes['GET /api/contracts/clients/7'] = () => ({ contracts: [] });
    wrap(<ClientContracts clientId={7} canCreate />);
    expect(await screen.findByText('No contracts yet.')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /api/me')).toBe(true));
    expect(screen.queryByRole('link', { name: 'New contract or work order' })).toBeNull();
  });
});

describe('R25 Screen B, new contract', () => {
  it('prefills from the client, picks scope items, previews and sends', async () => {
    routes['GET /api/contracts/templates'] = () => ({ templates: TEMPLATES });
    routes['GET /api/contracts/services'] = () => ({ services: SERVICES });
    routes['GET /api/contracts/new?clientId=7&templateId=5'] = () => ({
      templateId: 5,
      templateVersion: 1,
      kind: 'work_order',
      title: 'Work order, Acme Ltd',
      fields: FIELDS,
      values: { client_name: 'Acme Ltd' },
      signer: { name: 'Dana Cohen', email: 'dana@acme.co.il', phone: '' },
      linkDays: [7, 14, 30],
      ownerSignature: true,
      emailReady: true,
    });
    routes['POST /api/contracts/preview'] = () => '<p>preview</p>';
    routes['POST /api/contracts'] = () => ({ contract: { ...SIGNED, id: 21, status: 'draft' } });
    routes['POST /api/contracts/21/send'] = () => ({ url: 'https://ledger.test/api/sending/public/c/tok', whatsappUrl: 'https://wa.me/?text=x', expiresAt: '2026-10-26T00:00:00Z', emailed: true, sha256: 'a' });

    wrap(
      <Routes>
        <Route path="/contracts/new" element={<ContractEditor />} />
      </Routes>,
      '/contracts/new?clientId=7',
    );
    const clientField = await screen.findByLabelText('Client name (from the client)');
    expect(clientField).toHaveValue('Acme Ltd');
    expect(screen.getByText('The client fills these when signing: Your name.')).toBeInTheDocument();
    expect(await screen.findByLabelText(/Sign as Dana Owner when sending/)).toBeChecked();

    fireEvent.click(screen.getByRole('checkbox', { name: /Fractional CMO/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Weekly operating cadence' }));
    fireEvent.change(screen.getByLabelText('Fractional CMO: Fee: Amount'), { target: { value: '32,000' } });
    fireEvent.change(screen.getByLabelText('Monthly fee: Amount'), { target: { value: '100' } });

    await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/contracts/preview')).toBe(true), { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: 'Send for signing' }));
    await screen.findByText('Sent for signing');
    expect(screen.getByText('Emailed to dana@acme.co.il.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Share on WhatsApp' })).toHaveAttribute('href', 'https://wa.me/?text=x');
    const created = calls.find((c) => c.key === 'POST /api/contracts')!.body as any;
    expect(created.values.scope).toEqual({ services: [{ serviceId: 11, itemIds: [101], other: null, note: null, fee: { amountMinor: 3200000, currency: 'ILS' } }] });
    expect(created.values.fee).toEqual({ amountMinor: 10000, currency: 'ILS' });
    expect(created.ownerSign).toBe(true);
    expect(calls.find((c) => c.key === 'POST /api/contracts/21/send')!.body).toEqual({ channel: 'email' });
  });
});

describe('R25 Screen D, signed record', () => {
  it('shows the download, the events with a masked IP and the device, and creates a pro forma', async () => {
    routes['GET /api/contracts/9'] = () => ({ contract: SIGNED, currentTemplateVersion: 1, currentFields: FIELDS, emailReady: true, ownerSignature: true });
    routes['POST /api/contracts/9/proforma'] = () => ({ documentId: 77 });
    wrap(
      <Routes>
        <Route path="/contracts/:id" element={<ContractPage />} />
        <Route path="/income/documents/:id/edit" element={<p>Pro forma editor</p>} />
      </Routes>,
      '/contracts/9',
    );
    expect(await screen.findByRole('link', { name: 'Download signed PDF' })).toHaveAttribute('href', '/api/contracts/9/pdf?which=signed&download=1');
    expect(screen.getByText(/Signed by Dana Cohen, CEO/)).toBeInTheDocument();
    expect(screen.getAllByText(/IP 84\.229\.x\.x/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/iPhone Safari/).length).toBeGreaterThan(0);
    expect(screen.getByText('Identity confirmed by an email code.')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Create pro forma' }));
    await screen.findByText('Pro forma editor');
  });
});

describe('R25 Screen E, contract templates', () => {
  it('lists templates with field and use counts and saves an edit', async () => {
    routes['GET /api/contracts/templates'] = () => ({ templates: TEMPLATES });
    routes['GET /api/contracts/services?all=1'] = () => ({ services: SERVICES });
    routes['PUT /api/contracts/templates/6'] = (b) => ({ template: { ...TEMPLATES[1], ...(b as object) } });
    wrap(<ContractTemplatesTab />);
    expect(await screen.findByText('Services agreement')).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();
    expect(await screen.findByText('Fractional CMO')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]!);
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Services agreement 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    const body = calls.find((c) => c.key === 'PUT /api/contracts/templates/6')!.body as any;
    expect(body.name).toBe('Services agreement 2');
    expect(body.fields).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('reads money without floats, masks IPs, names devices and parses options', () => {
    expect(toMinor('32,000')).toBe(3200000);
    expect(toMinor('1.5')).toBe(150);
    expect(toMinor('abc')).toBeNull();
    expect(maskIp('84.229.10.20')).toBe('84.229.x.x');
    expect(deviceOf('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537')).toBe('Windows Chrome');
    const opts = textToOptions('one_time|One-time\nminimum|Minimum term: ___ months*', []);
    expect(opts).toEqual([
      { value: 'one_time', labelEn: 'One-time', labelHe: '', freeText: false },
      { value: 'minimum', labelEn: 'Minimum term: ___ months', labelHe: '', freeText: true },
    ]);
    expect(optionsToText(opts)).toBe('one_time|One-time\nminimum|Minimum term: ___ months*');
  });
});
