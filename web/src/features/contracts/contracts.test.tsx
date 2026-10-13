import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesProvider } from '../../app/preferences';
import { ToastProvider } from '../../components/Toast';
import type { ContractDetail, FieldDef, Service, Template } from './api';
import { ClientContracts } from './ClientContracts';
import { ContractEditor, defaultTermsTemplate, toMinor } from './ContractEditor';
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
  includedTemplate: null,
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
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
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
    expect(calls.some((c) => c.key === 'POST /api/contracts/8/remind')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remind by email' }));
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

describe('R25b, Standard Terms and Work Order together', () => {
  const TERMS_FIELD = f({ key: 'terms_signed_date', kind: 'owner_input', inputType: 'date', labelEn: 'Terms signed on', required: true, role: 'terms_date' });
  const WO_FIELDS: FieldDef[] = [f({ key: 'client_name', kind: 'client', source: 'name', labelEn: 'Client name' }), TERMS_FIELD, f({ key: 'start', kind: 'owner_input', inputType: 'date', labelEn: 'Start date' })];
  const WITH_TERMS: Template[] = [
    { ...TEMPLATES[0]!, fields: WO_FIELDS },
    TEMPLATES[1]!,
    { id: 7, name: 'Standard Terms', kind: 'contract', version: 3, active: true, bodyEn: 'x', bodyHe: '', fields: [], fieldCount: 20, usedCount: 2, updatedAt: '' },
  ];

  it('presets the picker to Standard Terms, else the first contract template', () => {
    expect(defaultTermsTemplate(WITH_TERMS)).toBe(7);
    expect(defaultTermsTemplate(TEMPLATES)).toBe(6);
    expect(defaultTermsTemplate([TEMPLATES[0]!])).toBeNull();
  });

  it('ticking the box adds the terms fields, hides the terms date and sends both templates', async () => {
    routes['GET /api/contracts/templates'] = () => ({ templates: WITH_TERMS });
    routes['GET /api/contracts/services'] = () => ({ services: SERVICES });
    const defaults = (fields: FieldDef[], included: unknown) => () => ({
      templateId: 5,
      templateVersion: 1,
      includedTemplate: included,
      kind: 'work_order',
      title: 'Work order, Acme Ltd',
      fields,
      values: { client_name: 'Acme Ltd', terms_place: 'Tel Aviv' },
      signer: { name: 'Dana Cohen', email: 'dana@acme.co.il', phone: '' },
      linkDays: [7, 14, 30],
      ownerSignature: true,
      emailReady: true,
    });
    routes['GET /api/contracts/new?clientId=7&templateId=5'] = defaults(WO_FIELDS, null);
    routes['GET /api/contracts/new?clientId=7&templateId=5&includeTemplateId=7'] = defaults(
      [WO_FIELDS[0]!, { ...TERMS_FIELD, kind: 'signed_date', party: 'client', required: false }, WO_FIELDS[2]!, f({ key: 'terms_place', kind: 'owner_input', inputType: 'text', labelEn: 'Governing place' })],
      { id: 7, name: 'Standard Terms', version: 3 },
    );
    routes['POST /api/contracts/preview'] = () => '<p>preview</p>';
    routes['POST /api/contracts'] = () => ({ contract: { ...SIGNED, id: 22, status: 'draft' } });

    wrap(
      <Routes>
        <Route path="/contracts/new" element={<ContractEditor />} />
      </Routes>,
      '/contracts/new?clientId=7',
    );
    const box = await screen.findByRole('checkbox', { name: 'Include the Service Agreement (first engagement)' });
    expect(box).not.toBeChecked();
    expect(screen.getByLabelText('Terms template')).toHaveValue('7');
    expect(await screen.findByLabelText(/^Terms signed on/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-12-01' } });

    fireEvent.click(box);
    expect(await screen.findByText('Filled with the signing date')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Terms signed on/)).toBeNull();
    expect(await screen.findByLabelText('Governing place')).toHaveValue('Tel Aviv');
    // What the owner typed before ticking stays.
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-12-01');

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/contracts')).toBe(true));
    const created = calls.find((c) => c.key === 'POST /api/contracts')!.body as any;
    expect(created.includeTemplateId).toBe(7);
    expect(created.values.start).toBe('2026-12-01');
  });

  const newDefaults = (templateId: number, kind: 'contract' | 'work_order') => () => ({
    templateId,
    templateVersion: 1,
    includedTemplate: null,
    kind,
    title: kind === 'work_order' ? 'Work order, Acme Ltd' : 'Agreement, Acme Ltd',
    fields: kind === 'work_order' ? WO_FIELDS : [],
    values: {},
    signer: { name: '', email: '', phone: '' },
    linkDays: [7, 14, 30],
    ownerSignature: false,
    emailReady: true,
  });

  const openEditor = () => {
    routes['GET /api/contracts/templates'] = () => ({ templates: [WITH_TERMS[1]!, WITH_TERMS[0]!, WITH_TERMS[2]!] });
    routes['GET /api/contracts/services'] = () => ({ services: SERVICES });
    routes['GET /api/contracts/new?clientId=7&templateId=5'] = newDefaults(5, 'work_order');
    routes['GET /api/contracts/new?clientId=7&templateId=6'] = newDefaults(6, 'contract');
    routes['POST /api/contracts/preview'] = () => '<p>preview</p>';
    wrap(
      <Routes>
        <Route path="/contracts/new" element={<ContractEditor />} />
      </Routes>,
      '/contracts/new?clientId=7',
    );
  };

  it('a new contract starts on the work order template even when a contract template is listed first', async () => {
    openEditor();
    await waitFor(() => expect(screen.getByLabelText('Template')).toHaveValue('5'));
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /api/contracts/new?clientId=7&templateId=5')).toBe(true));
    expect(calls.some((c) => c.key === 'GET /api/contracts/new?clientId=7&templateId=6')).toBe(false);
  });

  it('the checkbox shows for a work order only', async () => {
    openEditor();
    expect(await screen.findByTestId('include-terms')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: '6' } });
    await waitFor(() => expect(calls.some((c) => c.key === 'GET /api/contracts/new?clientId=7&templateId=6')).toBe(true));
    await waitFor(() => expect(screen.queryByTestId('include-terms')).toBeNull());
  });

  it('the client contracts tab shows Work Order + Standard Terms', async () => {
    routes['GET /api/contracts/clients/7'] = () => ({
      contracts: [{ id: 9, title: 'First engagement', kind: 'work_order', templateName: 'Work Order + Standard Terms', status: 'sent', sentAt: '2026-10-12T11:00:00Z', viewedAt: null, signedAt: null, expiresAt: null, signerEmail: null }],
    });
    wrap(<ClientContracts clientId={7} canCreate />);
    expect(await screen.findByText('Work Order + Standard Terms')).toBeInTheDocument();
  });
});

const EXTERNAL: ContractDetail = {
  ...SIGNED,
  id: 31,
  title: 'Master services agreement',
  kind: 'contract',
  templateName: 'Signed outside the Ledger',
  origin: 'external',
  sentAt: null,
  viewedAt: null,
  signedAt: '2026-09-15',
  expiresAt: null,
  sentSha256: null,
  signedSha256: 'beef00',
  identityMethod: null,
  overview: { services: [], terms: [], signedBy: null, ownerSignedAt: null },
  external: { signerName: 'Dana Cohen', signerRole: 'CEO', signerEmail: 'dana@acme.co.il', signedDate: '2026-09-15', startDate: '2026-10-01', endDate: '2027-09-30', fee: '₪15,000.00', notes: 'Signed on paper.' },
  events: [{ id: 9, kind: 'uploaded', label: 'Signed contract filed by owner@example.com · hash beef…', actor: 'owner@example.com', role: 'owner', ip: null, userAgent: null, at: '2026-10-13T08:00:00Z' }],
};

describe('R28, contracts signed elsewhere', () => {
  it('the contracts tab adds a signed contract with its PDF and opens it', async () => {
    routes['GET /api/contracts/clients/7'] = () => ({ contracts: [] });
    routes['POST /api/contracts/external'] = () => ({ contract: EXTERNAL });
    routes['GET /api/contracts/31'] = () => ({ contract: EXTERNAL, currentTemplateVersion: 1, currentFields: [], emailReady: true, ownerSignature: false });
    wrap(
      <Routes>
        <Route path="/clients/7" element={<ClientContracts clientId={7} canCreate />} />
        <Route path="/contracts/:id" element={<ContractPage />} />
      </Routes>,
      '/clients/7',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add a signed contract' }));
    const save = screen.getByRole('button', { name: 'Save signed contract' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Master services agreement' } });
    fireEvent.change(screen.getByLabelText('Signed on'), { target: { value: '2026-09-15' } });
    fireEvent.change(screen.getByLabelText('Signer name'), { target: { value: 'Dana Cohen' } });
    fireEvent.change(screen.getByLabelText('Signer role (optional)'), { target: { value: 'CEO' } });
    fireEvent.change(screen.getByLabelText('Fee (optional)'), { target: { value: '15000' } });
    const pdf = new File(['%PDF-1.7'], 'signed.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Signed PDF, up to 20 MB'), { target: { files: [pdf] } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    expect(await screen.findByText('Master services agreement')).toBeInTheDocument();
    const sent = calls.find((c) => c.key === 'POST /api/contracts/external')!.body as FormData;
    expect(sent).toBeInstanceOf(FormData);
    expect(sent.get('clientId')).toBe('7');
    expect(sent.get('kind')).toBe('contract');
    expect(sent.get('signedDate')).toBe('2026-09-15');
    expect(sent.get('feeAmountMinor')).toBe('1500000');
    expect(sent.get('feeCurrency')).toBe('ILS');
    expect((sent.get('file') as File).name).toBe('signed.pdf');
  });

  it('a fee that is not a number stops the upload', async () => {
    routes['GET /api/contracts/clients/7'] = () => ({ contracts: [] });
    wrap(<ClientContracts clientId={7} canCreate />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a signed contract' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Signed on'), { target: { value: '2026-09-15' } });
    fireEvent.change(screen.getByLabelText('Signer name'), { target: { value: 'Dana' } });
    fireEvent.change(screen.getByLabelText('Fee (optional)'), { target: { value: 'fifteen' } });
    fireEvent.change(screen.getByLabelText('Signed PDF, up to 20 MB'), { target: { files: [new File(['%PDF'], 'a.pdf')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Save signed contract' }));
    expect(await screen.findByText('Write the fee as a number, like 15000 or 15000.50.')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/contracts/external')).toBe(false);
  });

  it('the list shows Signed outside the Ledger in place of the template', async () => {
    routes['GET /api/contracts/clients/7'] = () => ({ contracts: [{ ...EXTERNAL, origin: 'external' }] });
    wrap(<ClientContracts clientId={7} canCreate />);
    expect(await screen.findByText('Signed outside the Ledger')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remind' })).toBeNull();
  });

  it('the contract page shows what was entered, the PDF, and no evidence trail', async () => {
    routes['GET /api/contracts/31'] = () => ({ contract: EXTERNAL, currentTemplateVersion: 1, currentFields: [], emailReady: true, ownerSignature: false });
    wrap(
      <Routes>
        <Route path="/contracts/:id" element={<ContractPage />} />
      </Routes>,
      '/contracts/31',
    );
    const overview = await screen.findByTestId('external-overview');
    expect(overview).toHaveTextContent('Dana Cohen, CEO');
    expect(overview).toHaveTextContent('2026-10-01');
    expect(overview).toHaveTextContent('2027-09-30');
    expect(overview).toHaveTextContent('₪15,000.00');
    expect(screen.getByText('Signed on paper.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', '/api/contracts/31/pdf?which=signed&download=1');
    fireEvent.click(screen.getByRole('button', { name: 'Record (1 event)' }));
    expect(screen.getByTestId('external-record')).toHaveTextContent('Signed outside the Ledger.');
    expect(screen.getAllByText(/Signed outside the Ledger/).length).toBeGreaterThan(1);
    expect(screen.queryByText(/Identity confirmed/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create pro forma' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Void' })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Record (3 events)' }));
    expect(screen.getByText(/Signed by Dana Cohen, CEO/)).toBeInTheDocument();
    expect(screen.getAllByText(/IP 84\.229\.x\.x/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/iPhone Safari/).length).toBeGreaterThan(0);
    expect(screen.getByText('Identity confirmed by an email code.')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Create pro forma' }));
    await screen.findByText('Pro forma editor');
  });
});

describe('R28, the Record card folds', () => {
  it('starts closed, opens and closes from its header, and the Overview stays open', async () => {
    routes['GET /api/contracts/9'] = () => ({ contract: { ...SIGNED, overview: { services: [], terms: [{ key: 'fee', label: 'Monthly fee', value: '₪32,000.00' }], signedBy: null, ownerSignedAt: null } }, currentTemplateVersion: 1, currentFields: FIELDS, emailReady: true, ownerSignature: true });
    wrap(
      <Routes>
        <Route path="/contracts/:id" element={<ContractPage />} />
      </Routes>,
      '/contracts/9',
    );
    const toggle = await screen.findByRole('button', { name: 'Record (3 events)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('contract-events')).toBeNull();
    expect(screen.queryByText(/SHA-256/)).toBeNull();
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('₪32,000.00')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('contract-events')).toBeInTheDocument();
    expect(screen.getByText('Identity confirmed by an email code.')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId('contract-events')).toBeNull();
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
