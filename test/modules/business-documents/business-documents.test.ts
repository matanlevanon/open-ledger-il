import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../../src/core/audit';
import { all, first, run } from '../../../src/core/db';
import { createApp } from '../../../src/index';
import { accessModule } from '../../../src/modules/access';
import {
  alertExpiringDocuments,
  createBusinessDocumentsModule,
  createShareLink,
  expiringDocuments,
  fakeBusinessDocumentReader,
} from '../../../src/modules/business-documents';
import { createBusinessesModule } from '../../../src/modules/businesses';
import { createDashboardModule } from '../../../src/modules/dashboard';
import { FakeMailer, createSendingModule } from '../../../src/modules/sending';
import { OWNER, TODAY } from '../businesses/helpers';

/**
 * R24 Phase C (C8): business documents. Upload, write-once storage and replace, parsing with a
 * fake reader, the confirm flow, share links valid, expired and revoked, audit rows and roles.
 */
const reader = fakeBusinessDocumentReader({
  type: 'bookkeeping',
  nameHe: 'עסק לדוגמה',
  nameEn: 'Sample Business',
  taxId: '123456782',
  issueDate: '2026-04-01',
  validUntil: '2027-03-31',
});
const mailer = new FakeMailer();
const slack: string[] = [];
const fakeSlack: typeof fetch = async (_input, init) => {
  slack.push(JSON.parse(String(init?.body)).text);
  return new Response('ok');
};
const docsModule = createBusinessDocumentsModule({ readerFor: () => reader, resolveMailer: () => mailer, fetchFn: fakeSlack });
const app = createApp({
  modules: [
    createBusinessesModule(),
    docsModule,
    createSendingModule(() => mailer),
    createDashboardModule({ today: () => TODAY }),
    accessModule,
  ],
});

const ASSISTANT = 'noauto-bd-assistant@example.com';
const CPA = 'noauto-bd-cpa@example.com';
const CPA_OFF = 'noauto-bd-cpa-off@example.com';

async function call(email: string, method: string, path: string, body?: unknown, businessId = 1) {
  const headers: Record<string, string> = { 'X-Business-Id': String(businessId) };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await app.request(path.startsWith('/api') ? path : `/api${path}`, { method, headers, body: payload }, { ...env, DEV_AUTH_EMAIL: email });
  return res;
}

async function json(email: string, method: string, path: string, body?: unknown, businessId = 1) {
  const res = await call(email, method, path, body, businessId);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
}

function pdf(text: string): File {
  return new File([`%PDF-1.4\n${text}\n%%EOF`], `${text}.pdf`, { type: 'application/pdf' });
}

function upload(file: File, type: string, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set('file', file);
  form.set('type', type);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return form;
}

const auditCount = async (action: string) =>
  (await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM audit_log WHERE action = ?', action))!.n;

beforeAll(async () => {
  await run(env.DB, "UPDATE businesses SET tax_id = '123456782', name_en = 'Sample Business' WHERE id = 1");
  await json(OWNER, 'GET', '/businesses');
  expect((await json(OWNER, 'POST', '/access/users', { email: ASSISTANT, role: 'assistant' })).status).toBe(201);
  expect((await json(OWNER, 'POST', '/access/users', { email: CPA, accessEndsOn: '2027-12-31', features: { business_documents: true } })).status).toBe(201);
  expect((await json(OWNER, 'POST', '/access/users', { email: CPA_OFF, accessEndsOn: '2027-12-31' })).status).toBe(201);
});

describe('upload, parse and confirm', () => {
  let firstId = 0;

  it('stores the file write-once under the business and reads its fields', async () => {
    const before = reader.calls;
    const res = await json(OWNER, 'POST', '/business-documents', upload(pdf('bookkeeping-2026'), 'bookkeeping'));
    expect(res.status).toBe(201);
    const doc = res.body.document;
    firstId = doc.id;
    expect(reader.calls).toBe(before + 1);
    expect(doc.extracted).toMatchObject({ nameEn: 'Sample Business', taxId: '123456782' });
    expect(doc.check).toEqual({ taxIdValid: true, taxIdMatches: true });
    expect(doc.validUntil).toBe('2027-03-31');
    expect(doc.confirmedAt).toBeNull();
    const row = (await first<{ r2_key: string; sha256: string }>(env.DB, 'SELECT r2_key, sha256 FROM business_documents WHERE id = ?', doc.id))!;
    expect(row.r2_key).toBe(`business/1/documents/${row.sha256}.pdf`);
    expect(await env.FILES.head(row.r2_key)).not.toBeNull();
  });

  it('refuses a wrong file type and an oversize file', async () => {
    const txt = new File(['hello'], 'a.txt', { type: 'text/plain' });
    expect((await json(OWNER, 'POST', '/business-documents', upload(txt, 'other'))).status).toBe(400);
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' });
    expect((await json(OWNER, 'POST', '/business-documents', upload(big, 'other'))).status).toBe(400);
  });

  it('warns when the number is not this business or fails the checksum', async () => {
    const other = createBusinessDocumentsModule({
      readerFor: () => fakeBusinessDocumentReader({ type: 'vat_registration', taxId: '123456789' }),
    });
    const otherApp = createApp({ modules: [other] });
    const res = await otherApp.request(
      '/api/business-documents',
      { method: 'POST', headers: { 'X-Business-Id': '1' }, body: upload(pdf('vat-wrong-number'), 'vat_registration') },
      { ...env, DEV_AUTH_EMAIL: OWNER },
    );
    const doc = ((await res.json()) as any).document;
    expect(doc.check).toEqual({ taxIdValid: false, taxIdMatches: false });
  });

  it('works without a reader: the owner types the fields', async () => {
    const manual = createApp({ modules: [createBusinessDocumentsModule({ readerFor: () => null })] });
    const res = await manual.request(
      '/api/business-documents',
      { method: 'POST', headers: { 'X-Business-Id': '1' }, body: upload(pdf('bank-manual'), 'bank_account', { issueDate: '2026-01-05' }) },
      { ...env, DEV_AUTH_EMAIL: OWNER },
    );
    expect(res.status).toBe(201);
    const doc = ((await res.json()) as any).document;
    expect(doc.extracted).toBeNull();
    expect(doc.issueDate).toBe('2026-01-05');
  });

  it('confirms the dates once, then the row is fixed', async () => {
    const res = await json(OWNER, 'POST', `/business-documents/${firstId}/confirm`, { issueDate: '2026-04-01', validUntil: '2027-03-31' });
    expect(res.status).toBe(200);
    expect(res.body.document.confirmedAt).not.toBeNull();
    expect((await json(OWNER, 'POST', `/business-documents/${firstId}/confirm`, { validUntil: '2028-01-01' })).status).toBe(400);
    await expect(run(env.DB, "UPDATE business_documents SET valid_until = '2030-01-01' WHERE id = ?", firstId)).rejects.toThrow();
    await expect(run(env.DB, 'DELETE FROM business_documents WHERE id = ?', firstId)).rejects.toThrow();
    // Confirming never writes the business profile.
    expect((await first<{ name_en: string }>(env.DB, 'SELECT name_en FROM businesses WHERE id = 1'))!.name_en).toBe('Sample Business');
  });

  it('a new upload of the same type replaces the current one, the old stays listed', async () => {
    const again = await json(OWNER, 'POST', '/business-documents', upload(pdf('bookkeeping-2026'), 'bookkeeping'));
    expect(again.body.document.id).toBe(firstId);
    const next = await json(OWNER, 'POST', '/business-documents', upload(pdf('bookkeeping-2027'), 'bookkeeping'));
    expect(next.status).toBe(201);
    const list = (await json(OWNER, 'GET', '/business-documents')).body.documents as any[];
    const bookkeeping = list.filter((d) => d.type === 'bookkeeping');
    expect(bookkeeping.map((d) => [d.id, d.current])).toEqual([
      [next.body.document.id, true],
      [firstId, false],
    ]);
    expect(bookkeeping[1].replacedBy).toBe(next.body.document.id);
    expect(await auditCount('business_document.upload')).toBeGreaterThanOrEqual(3);
  });

  it('reads a certificate for Add business without storing it', async () => {
    const before = (await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM business_documents'))!.n;
    const form = new FormData();
    form.set('file', pdf('company-cert'));
    const res = await json(OWNER, 'POST', '/business-documents/read', form);
    expect(res.status).toBe(200);
    expect(res.body.extracted.taxId).toBe('123456782');
    expect((await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM business_documents'))!.n).toBe(before);
  });
});

describe('view, download and share links', () => {
  let docId = 0;
  beforeAll(async () => {
    docId = (await json(OWNER, 'POST', '/business-documents', upload(pdf('withholding-share'), 'withholding'))).body.document.id;
  });

  it('views inline and downloads, each audited', async () => {
    const views = await auditCount('business_document.view');
    const view = await call(OWNER, 'GET', `/business-documents/${docId}/file`);
    expect(view.status).toBe(200);
    expect(view.headers.get('content-disposition')).toMatch(/^inline/);
    await view.arrayBuffer();
    const dl = await call(OWNER, 'GET', `/business-documents/${docId}/file?download=1`);
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment/);
    await dl.arrayBuffer();
    expect(await auditCount('business_document.view')).toBe(views + 1);
    expect(await auditCount('business_document.download')).toBeGreaterThanOrEqual(1);
  });

  it('a valid link opens without a sign-in, and each opening is audited', async () => {
    const res = await json(OWNER, 'POST', `/business-documents/${docId}/share`, {});
    expect(res.status).toBe(201);
    const { url, expiresAt } = res.body.link;
    const days = Math.round((Date.parse(expiresAt) - Date.now()) / 86_400_000);
    expect(days).toBe(7);
    const path = new URL(url).pathname;
    expect(path.startsWith('/api/sending/public/bd/')).toBe(true);
    const opens = await auditCount('business_document.shared_open');
    // No DEV_AUTH_EMAIL: a stranger with the link.
    const open = await app.request(path, {}, { ...env, DEV_AUTH_EMAIL: '' });
    expect(open.status).toBe(200);
    expect(open.headers.get('content-type')).toBe('application/pdf');
    await open.arrayBuffer();
    expect(await auditCount('business_document.shared_open')).toBe(opens + 1);
    const links = (await json(OWNER, 'GET', '/business-documents/links')).body.links as any[];
    expect(links.find((l) => l.id === res.body.link.id)?.openCount).toBe(1);
  });

  it('a revoked link opens nothing', async () => {
    const { link } = (await json(ASSISTANT, 'POST', `/business-documents/${docId}/share`, { days: 1 })).body;
    const revoked = await json(ASSISTANT, 'POST', `/business-documents/links/${link.id}/revoke`);
    expect(revoked.body.links.some((l: any) => l.id === link.id)).toBe(false);
    const open = await app.request(new URL(link.url).pathname, {}, { ...env, DEV_AUTH_EMAIL: '' });
    expect(open.status).toBe(410);
    expect(await open.text()).toContain('turned off');
  });

  it('an expired link opens nothing', async () => {
    const link = await createShareLink(env, { ...SYSTEM_ACTOR, businessId: 1 }, 1, docId, {
      days: 1,
      channel: 'link',
      baseUrl: 'https://ledger.test',
      now: Date.now() - 2 * 86_400_000,
    });
    const open = await app.request(new URL(link.url).pathname, {}, { ...env, DEV_AUTH_EMAIL: '' });
    expect(open.status).toBe(410);
    expect(await open.text()).toContain('expired');
  });

  it('refuses a link lifetime other than 1, 7 or 30 days, and a forged token', async () => {
    expect((await json(OWNER, 'POST', `/business-documents/${docId}/share`, { days: 3 })).status).toBe(400);
    const open = await app.request('/api/sending/public/bd/abc.def', {}, { ...env, DEV_AUTH_EMAIL: '' });
    expect(open.status).toBe(410);
  });

  it('sends a link by email under the business name', async () => {
    const res = await json(OWNER, 'POST', `/business-documents/${docId}/share/email`, { to: 'bank@example.com', days: 30 });
    expect(res.status).toBe(201);
    const sent = mailer.sent.at(-1)!;
    expect(sent.to).toBe('bank@example.com');
    expect(sent.fromName).toBe('Sample Business');
    expect(sent.text).toContain('/api/sending/public/bd/');
    const row = await first<{ channel: string; sent_to: string }>(env.DB, 'SELECT channel, sent_to FROM business_document_links WHERE id = ?', res.body.link.id);
    expect(row).toEqual({ channel: 'email', sent_to: 'bank@example.com' });
  });
});

describe('roles', () => {
  let docId = 0;
  beforeAll(async () => {
    docId = (await json(OWNER, 'POST', '/business-documents', upload(pdf('roles-vat'), 'vat_registration'))).body.document.id;
  });

  it('the assistant views and shares, never uploads or confirms', async () => {
    expect((await json(ASSISTANT, 'GET', '/business-documents')).status).toBe(200);
    expect((await call(ASSISTANT, 'GET', `/business-documents/${docId}/file`)).status).toBe(200);
    expect((await json(ASSISTANT, 'POST', `/business-documents/${docId}/share`, {})).status).toBe(201);
    expect((await json(ASSISTANT, 'POST', '/business-documents', upload(pdf('assistant-try'), 'other'))).status).toBe(403);
    expect((await json(ASSISTANT, 'POST', `/business-documents/${docId}/confirm`, {})).status).toBe(403);
  });

  it('the accountant views with the switch on, each view audited, and never shares', async () => {
    const views = await all<{ user_email: string }>(env.DB, "SELECT user_email FROM audit_log WHERE action = 'business_document.view' AND user_email = ?", CPA);
    expect((await json(CPA, 'GET', '/business-documents')).status).toBe(200);
    const view = await call(CPA, 'GET', `/business-documents/${docId}/file`);
    expect(view.status).toBe(200);
    await view.arrayBuffer();
    const after = await all(env.DB, "SELECT user_email FROM audit_log WHERE action = 'business_document.view' AND user_email = ?", CPA);
    expect(after.length).toBe(views.length + 1);
    expect((await json(CPA, 'POST', `/business-documents/${docId}/share`, {})).status).toBe(403);
    expect((await json(CPA, 'GET', '/business-documents/links')).status).toBe(403);
  });

  it('the accountant without the switch sees nothing', async () => {
    expect((await json(CPA_OFF, 'GET', '/business-documents')).status).toBe(403);
    expect((await call(CPA_OFF, 'GET', `/business-documents/${docId}/file`)).status).toBe(403);
  });

  it('a document of another business is not found', async () => {
    const b2 = (
      await json(OWNER, 'POST', '/businesses', { entityType: 'company', nameEn: 'Docs Co Ltd', nameHe: 'מסמכים בע"מ', taxId: '515555555', addressEn: 'Haifa' })
    ).body.businessId as number;
    expect((await call(OWNER, 'GET', `/business-documents/${docId}/file`, undefined, b2)).status).toBe(404);
    const theirs = await json(OWNER, 'POST', '/business-documents', upload(pdf('b2-vat'), 'vat_registration'), b2);
    expect(theirs.status).toBe(201);
    const key = (await first<{ r2_key: string }>(env.DB, 'SELECT r2_key FROM business_documents WHERE id = ?', theirs.body.document.id))!.r2_key;
    expect(key.startsWith(`business/${b2}/documents/`)).toBe(true);
    expect((await json(OWNER, 'GET', '/business-documents', undefined, b2)).body.documents).toHaveLength(1);
  });
});

describe('expiry', () => {
  it('opens one task and one Slack alert 30 days before a certificate ends, and the dashboard shows it', async () => {
    const res = await json(OWNER, 'POST', '/business-documents', upload(pdf('withholding-ends'), 'withholding', { validUntil: '2026-12-10' }));
    const id = res.body.document.id as number;
    expect((await expiringDocuments(env.DB, 1, '2026-11-01')).some((d) => d.id === id)).toBe(false);
    const due = await expiringDocuments(env.DB, 1, TODAY);
    expect(due.find((d) => d.id === id)).toMatchObject({ validUntil: '2026-12-10', daysLeft: 20 });

    const notifier = { sent: [] as string[], async send(text: string) { this.sent.push(text); return true; } };
    expect(await alertExpiringDocuments(env.DB, 1, TODAY, notifier)).toContain(id);
    expect(await alertExpiringDocuments(env.DB, 1, TODAY, notifier)).not.toContain(id);
    expect(notifier.sent.filter((t) => t.includes('2026-12-10'))).toHaveLength(1);
    const tasks = await all(env.DB, "SELECT title FROM tasks WHERE kind = 'business_document_expiry' AND due_at = '2026-12-10'");
    expect(tasks).toHaveLength(1);

    const dash = await json(OWNER, 'GET', '/dashboard');
    expect(dash.body.expiringDocuments.some((d: any) => d.id === id)).toBe(true);
  });

  it('the 07:00 cron runs the sweep through the module', async () => {
    await json(OWNER, 'POST', '/business-documents', upload(pdf('bookkeeping-cron'), 'bookkeeping', { validUntil: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10) }));
    await docsModule.scheduled!({ cron: '0 7 * * *' } as ScheduledController, { ...env, SLACK_WEBHOOK_URL: 'https://hooks.example/x' }, {} as ExecutionContext);
    expect(slack.some((t) => t.includes('bookkeeping certificate'))).toBe(true);
  });
});
