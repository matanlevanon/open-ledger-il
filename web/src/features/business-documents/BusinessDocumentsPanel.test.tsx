import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { BusinessList } from '../../api/businesses';
import { PreferencesProvider } from '../../app/preferences';
import { ToastProvider } from '../../components/Toast';
import { BusinessesTab } from '../settings/BusinessesTab';
import { type BusinessDocument, type DocumentsList, PREFILL_KEY, takePrefill } from './api';
import { type BusinessDocumentsApi, BusinessDocumentsPanel } from './BusinessDocumentsPanel';

const doc = (over: Partial<BusinessDocument> = {}): BusinessDocument => ({
  id: 1,
  type: 'bookkeeping',
  typeLabel: { en: 'Bookkeeping certificate', he: 'אישור ניהול ספרים' },
  fileName: 'bookkeeping.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1200,
  issueDate: '2026-04-01',
  validUntil: '2027-03-31',
  extracted: { nameEn: 'Sample Business', taxId: '123456789' },
  check: { taxIdValid: false, taxIdMatches: false },
  confirmedAt: null,
  current: true,
  replacedBy: null,
  uploadedBy: 'owner@example.com',
  uploadedAt: '2026-10-12T08:00:00.000Z',
  ...over,
});

const list = (over: Partial<DocumentsList> = {}): DocumentsList => ({
  documents: [doc(), doc({ id: 2, fileName: 'old.pdf', current: false, replacedBy: 1, confirmedAt: '2025-04-01T00:00:00Z' })],
  types: [
    { type: 'vat_registration', label: { en: 'VAT registration certificate', he: 'תעודת עוסק' }, expires: false },
    { type: 'bookkeeping', label: { en: 'Bookkeeping certificate', he: 'אישור ניהול ספרים' }, expires: true },
  ],
  shareDays: [1, 7, 30],
  reader: { provider: 'anthropic', keySet: true },
  canManage: true,
  canShare: true,
  ...over,
});

function fakeApi(data: DocumentsList): BusinessDocumentsApi & { [k: string]: any } {
  return {
    load: vi.fn(async () => data),
    upload: vi.fn(async () => ({ document: doc(), readError: null })),
    confirm: vi.fn(async () => ({ document: doc({ confirmedAt: 'now' }) })),
    share: vi.fn(async () => ({ link: { id: 5, url: 'https://ledger.test/api/sending/public/bd/tok', expiresAt: '2026-10-19T00:00:00Z' } })),
    email: vi.fn(async () => ({ link: { id: 6, url: 'https://ledger.test/x', expiresAt: '2026-11-11T00:00:00Z' } })),
    links: vi.fn(async () => ({
      links: [{ id: 5, documentId: 1, documentType: 'bookkeeping' as const, fileName: 'bookkeeping.pdf', channel: 'link' as const, sentTo: null, expiresAt: '2026-10-19T00:00:00Z', createdAt: '', createdBy: null, openCount: 2, lastOpenedAt: null }],
    })),
    revoke: vi.fn(async () => ({ links: [] })),
  };
}

function wrap(ui: React.ReactNode) {
  return render(
    <MemoryRouter>
      <PreferencesProvider persist={() => undefined}>
        <ToastProvider>{ui}</ToastProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
}

describe('R24 Phase C business documents panel', () => {
  it('lists current and replaced documents with View and Download', async () => {
    wrap(<BusinessDocumentsPanel api={fakeApi(list())} />);
    expect((await screen.findAllByText('bookkeeping.pdf')).length).toBeGreaterThan(0);
    expect(screen.getByText('Replaced')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'View' })[0]).toHaveAttribute('href', '/api/business-documents/1/file');
    expect(screen.getAllByRole('link', { name: 'Download' })[0]).toHaveAttribute('href', '/api/business-documents/1/file?download=1');
  });

  it('uploads a file with its type and valid-until date', async () => {
    const api = fakeApi(list({ documents: [] }));
    wrap(<BusinessDocumentsPanel api={api} />);
    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: 'bookkeeping' } });
    const file = new File(['%PDF'], 'cert.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/^File/), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('Valid until'), { target: { value: '2027-03-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(api.upload).toHaveBeenCalledWith({ file, type: 'bookkeeping', issueDate: undefined, validUntil: '2027-03-31' }));
  });

  it('shows the parsed fields with a checksum warning, confirms, and fills Settings > Business on request', async () => {
    const api = fakeApi(list());
    const onUseDetails = vi.fn();
    wrap(<BusinessDocumentsPanel api={api} onUseDetails={onUseDetails} />);
    const review = await screen.findByTestId('bdoc-review');
    expect(review).toHaveTextContent('Sample Business');
    expect(review).toHaveTextContent('fails the check digit');
    fireEvent.click(screen.getByRole('button', { name: 'Use these details' }));
    expect(onUseDetails).toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(PREFILL_KEY)!)).toEqual({ nameEn: 'Sample Business', taxId: '123456789' });
    expect(takePrefill()).toEqual({ nameEn: 'Sample Business', taxId: '123456789' });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.confirm).toHaveBeenCalledWith(1, { issueDate: '2026-04-01', validUntil: '2027-03-31' }));
  });

  it('shares a 7-day link by default, emails one, and revokes an active link', async () => {
    const api = fakeApi(list());
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
    wrap(<BusinessDocumentsPanel api={api} />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Share' }))[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(api.share).toHaveBeenCalledWith(1, 7, 'link'));
    expect(await screen.findByTestId('bdoc-link')).toHaveTextContent('/api/sending/public/bd/tok');
    fireEvent.change(screen.getByLabelText('Link lasts'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Email to'), { target: { value: 'bank@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send by email' }));
    await waitFor(() => expect(api.email).toHaveBeenCalledWith(1, 30, 'bank@example.com'));
    expect(screen.getByText('Opened 2 times')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(api.revoke).toHaveBeenCalledWith(5));
    expect(await screen.findByText('No active links.')).toBeInTheDocument();
  });

  it('an accountant sees View and Download only', async () => {
    const api = fakeApi(list({ canManage: false, canShare: false }));
    wrap(<BusinessDocumentsPanel api={api} />);
    expect((await screen.findAllByText('bookkeeping.pdf')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    expect(screen.queryByText('Upload a document')).toBeNull();
    expect(screen.queryByTestId('bdoc-review')).toBeNull();
    expect(api.links).not.toHaveBeenCalled();
  });
});

describe('R24 C6 Add business with a certificate', () => {
  const ONE: BusinessList = {
    current: 1,
    businesses: [{ id: 1, nameEn: 'Acme', nameHe: 'אקמה', taxId: '012345678', entityType: 'osek_patur', role: 'owner' }],
    addableTypes: ['company'],
  };

  it('fills the form from the certificate, then stores it in the new business', async () => {
    const readCert = vi.fn(async () => ({
      extracted: { type: 'company_registration' as const, nameEn: 'Acme Ltd', nameHe: 'אקמה בע"מ', taxId: '515555555' },
      check: { taxIdValid: true, taxIdMatches: null },
      readError: null,
      reader: true,
    }));
    const storeCert = vi.fn(async () => ({ document: doc(), readError: null }));
    const create = vi.fn(async () => ({ businessId: 2 }));
    wrap(<BusinessesTab load={async () => ONE} create={create} startAdding readCert={readCert} storeCert={storeCert} />);
    const file = new File(['%PDF'], 'company.pdf', { type: 'application/pdf' });
    fireEvent.change(await screen.findByLabelText(/^Upload a certificate/), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByLabelText('Business name (English)')).toHaveValue('Acme Ltd'));
    expect(screen.getByLabelText('Business name (Hebrew)')).toHaveValue('אקמה בע"מ');
    expect(screen.getByText('Read from the certificate. Check the details.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Address (English)'), { target: { value: '1 Main St' } });
    fireEvent.change(screen.getByPlaceholderText('מורשה'), { target: { value: 'מורשה' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add business' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ taxId: '515555555', nameEn: 'Acme Ltd' })));
    await waitFor(() => expect(storeCert).toHaveBeenCalledWith({ file, type: 'company_registration' }, 2));
  });
});

describe('R24 C3 Use these details', () => {
  it('Settings > Business fills its form from the certificate and saves nothing by itself', async () => {
    const { BusinessTab } = await import('../settings/BusinessTab');
    const { storePrefill } = await import('./api');
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const path = new URL(input, 'http://localhost').pathname;
        calls.push(`${init?.method ?? 'GET'} ${path}`);
        if (path === '/api/ops/business') return new Response(JSON.stringify({ business: { name_en: 'Old Name', name_he: 'שם ישן', tax_id: '000000018' } }), { status: 200 });
        if (path === '/api/legal-mode/status') return new Response(JSON.stringify({ entityType: 'osek_patur' }), { status: 200 });
        return new Response('{}', { status: 404 });
      }),
    );
    storePrefill({ nameEn: 'Sample Business', taxId: '123456782' });
    wrap(<BusinessTab />);
    expect(await screen.findByTestId('business-prefilled')).toBeInTheDocument();
    expect(screen.getByLabelText(/Business name \(English\)/)).toHaveValue('Sample Business');
    expect(screen.getByLabelText(/Business name \(Hebrew\)/)).toHaveValue('שם ישן');
    expect(calls.some((c) => c.startsWith('PUT'))).toBe(false);
    vi.unstubAllGlobals();
  });
});
