import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { all, first, run } from '../../../src/core/db';
import { createApp } from '../../../src/index';
import { accessModule } from '../../../src/modules/access';
import { createClientsModule } from '../../../src/modules/clients';
import { createContractsModule, EXTERNAL_MAX_BYTES, FakeContractPdfEngine, type ContractsOptions } from '../../../src/modules/contracts';
import { FakeMailer } from '../../../src/modules/sending';

/**
 * R28 task 2: a contract signed outside the Ledger, filed with its signed PDF. PDF only, the size
 * limit, write-once storage, no edit after upload, the accountant rules and void.
 */

const OWNER = 'owner@example.com';
const ASSISTANT = 'noauto-r28-assistant@example.com';
const CPA = 'noauto-r28-cpa@example.com';
const CPA_OFF = 'noauto-r28-cpa-off@example.com';
const TODAY = '2026-10-13';

const mailer = new FakeMailer();
const options: ContractsOptions = { engineFor: () => new FakeContractPdfEngine(), mailerFor: () => mailer };
const app = createApp({ modules: [createClientsModule({ today: () => TODAY }), accessModule, createContractsModule(options)] });
const envFor = (email: string) => ({ ...env, DEV_AUTH_EMAIL: email, PUBLIC_APP_URL: 'https://ledger.test' });

async function call(email: string, method: string, path: string, body?: unknown, businessId = 1) {
  const headers: Record<string, string> = { 'X-Business-Id': String(businessId) };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await app.request(`/api${path}`, { method, headers, body: payload }, envFor(email));
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  return { status: res.status, body: parsed, text };
}

const pdfBytes = (tag: string) => new TextEncoder().encode(`%PDF-1.7\n% ${tag}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);

let clientId = 0;
let externalId = 0;

function uploadForm(bytes: Uint8Array, extra: Record<string, string> = {}, name = 'signed.pdf'): FormData {
  const form = new FormData();
  form.set('file', new File([bytes], name, { type: 'application/pdf' }));
  const fields: Record<string, string> = {
    clientId: String(clientId),
    title: 'Master services agreement',
    kind: 'contract',
    signedDate: '2026-09-15',
    signerName: 'Dana Cohen',
    signerRole: 'CEO',
    signerEmail: 'dana@acme.example',
    startDate: '2026-10-01',
    endDate: '2027-09-30',
    feeAmountMinor: '1500000',
    feeCurrency: 'ILS',
    notes: 'Signed on paper at the first meeting.',
    ...extra,
  };
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return form;
}

beforeAll(async () => {
  expect((await call(OWNER, 'POST', '/access/users', { email: ASSISTANT, role: 'assistant' })).status).toBe(201);
  expect((await call(OWNER, 'POST', '/access/users', { email: CPA, accessEndsOn: '2027-12-31', features: { contracts: true } })).status).toBe(201);
  expect((await call(OWNER, 'POST', '/access/users', { email: CPA_OFF, accessEndsOn: '2027-12-31' })).status).toBe(201);
  clientId = (await call(OWNER, 'POST', '/clients', { nameEn: 'Acme Ltd', country: 'IL', email: 'office@acme.example' })).body.client.id;
});

describe('R28 contracts signed elsewhere', () => {
  it('files a signed PDF: status signed, origin external, write-once at business/<id>/contracts/<sha256>.pdf, an uploaded event', async () => {
    const bytes = pdfBytes('first');
    const res = await call(OWNER, 'POST', '/contracts/external', uploadForm(bytes));
    expect(res.status).toBe(201);
    const c = res.body.contract;
    externalId = c.id;
    expect(c.status).toBe('signed');
    expect(c.origin).toBe('external');
    expect(c.external).toEqual({
      signerName: 'Dana Cohen',
      signerRole: 'CEO',
      signerEmail: 'dana@acme.example',
      signedDate: '2026-09-15',
      startDate: '2026-10-01',
      endDate: '2027-09-30',
      fee: expect.stringContaining('15,000'),
      notes: 'Signed on paper at the first meeting.',
    });
    const row = (await first<{ signed_pdf_r2_key: string; signed_pdf_sha256: string; sent_pdf_r2_key: string | null; expires_at: string | null }>(
      env.DB,
      'SELECT signed_pdf_r2_key, signed_pdf_sha256, sent_pdf_r2_key, expires_at FROM contracts WHERE id = ?',
      externalId,
    ))!;
    expect(row.signed_pdf_r2_key).toBe(`business/1/contracts/${row.signed_pdf_sha256}.pdf`);
    expect(row.sent_pdf_r2_key).toBeNull();
    expect(row.expires_at).toBeNull();
    const stored = await env.FILES.get(row.signed_pdf_r2_key);
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(bytes);
    const events = await all<{ kind: string; actor_email: string; details_json: string }>(env.DB, 'SELECT kind, actor_email, details_json FROM contract_events WHERE contract_id = ?', externalId);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('uploaded');
    expect(events[0]!.actor_email).toBe(OWNER);
    expect(JSON.parse(events[0]!.details_json).sha256).toBe(row.signed_pdf_sha256);
    expect((await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'contract.upload'"))!.n).toBe(1);
  });

  it('PDF only, checked by its first bytes, not its name or type', async () => {
    const fake = new TextEncoder().encode('MZ not a pdf at all');
    const res = await call(OWNER, 'POST', '/contracts/external', uploadForm(fake, {}, 'contract.pdf'));
    expect(res.status).toBe(400);
    expect(res.text).toContain('PDF');
  });

  it('refuses a PDF over 20 MB', async () => {
    const big = new Uint8Array(EXTERNAL_MAX_BYTES + 1);
    big.set(pdfBytes('big'));
    const res = await call(OWNER, 'POST', '/contracts/external', uploadForm(big));
    expect(res.status).toBe(400);
    expect(res.text).toContain('20 MB');
  });

  it('write-once: the same PDF twice is refused', async () => {
    const res = await call(OWNER, 'POST', '/contracts/external', uploadForm(pdfBytes('first'), { title: 'Again' }));
    expect(res.status).toBe(409);
    expect((await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM contracts WHERE title = 'Again'"))!.n).toBe(0);
  });

  it('checks the fields: signer name, dates, fee currency', async () => {
    expect((await call(OWNER, 'POST', '/contracts/external', uploadForm(pdfBytes('a'), { signerName: '' }))).status).toBe(400);
    expect((await call(OWNER, 'POST', '/contracts/external', uploadForm(pdfBytes('b'), { signedDate: '15/09/2026' }))).status).toBe(400);
    expect((await call(OWNER, 'POST', '/contracts/external', uploadForm(pdfBytes('c'), { endDate: '2026-01-01' }))).status).toBe(400);
    expect((await call(OWNER, 'POST', '/contracts/external', uploadForm(pdfBytes('d'), { feeCurrency: '' }))).status).toBe(400);
    const minimal = uploadForm(pdfBytes('e'), { kind: 'work_order', signerRole: '', signerEmail: '', startDate: '', endDate: '', feeAmountMinor: '', feeCurrency: '', notes: '' });
    const res = await call(ASSISTANT, 'POST', '/contracts/external', minimal);
    expect(res.status).toBe(201);
    expect(res.body.contract.kind).toBe('work_order');
    expect(res.body.contract.external.fee).toBeNull();
  });

  it('no edit after upload: no change, send, remind or pro forma', async () => {
    const body = { clientId, templateId: 1, language: 'en', values: {}, signer: { name: 'x', email: 'x@y.z' } };
    expect((await call(OWNER, 'PUT', `/contracts/${externalId}`, body)).status).toBe(409);
    expect((await call(OWNER, 'POST', `/contracts/${externalId}/send`, { channel: 'link' })).status).toBe(409);
    expect((await call(OWNER, 'POST', `/contracts/${externalId}/remind`, { channel: 'link' })).status).toBe(409);
    expect((await call(OWNER, 'GET', `/contracts/${externalId}/pdf?which=sent`)).status).toBe(404);
    expect((await call(OWNER, 'GET', `/contracts/${externalId}/pdf?which=signed&download=1`)).status).toBe(200);
  });

  it('the hidden template never lists and never makes a Ledger contract', async () => {
    const hidden = (await first<{ id: number }>(env.DB, "SELECT id FROM contract_templates WHERE business_id = 1 AND origin = 'external' AND kind = 'contract'"))!.id;
    const { templates } = (await call(OWNER, 'GET', '/contracts/templates')).body;
    expect(templates.length).toBeGreaterThan(0);
    expect(templates.some((t: any) => t.id === hidden)).toBe(false);
    expect((await call(OWNER, 'GET', `/contracts/templates/${hidden}`)).status).toBe(404);
    expect((await call(OWNER, 'GET', `/contracts/new?clientId=${clientId}&templateId=${hidden}`)).status).toBe(404);
    expect((await call(OWNER, 'POST', '/contracts', { clientId, templateId: hidden, values: {} })).status).toBe(404);
  });

  it('accountant: views it with the contracts switch, every view audited, never uploads', async () => {
    const list = await call(CPA, 'GET', `/contracts/clients/${clientId}`);
    expect(list.status).toBe(200);
    expect(list.body.contracts.some((c: any) => c.id === externalId && c.origin === 'external')).toBe(true);
    expect((await call(CPA, 'GET', `/contracts/${externalId}`)).status).toBe(200);
    const count = async () => (await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'contract.view' AND user_email = ?", CPA))!.n;
    const before = await count();
    expect((await call(CPA, 'GET', `/contracts/${externalId}/pdf?which=signed`)).status).toBe(200);
    expect(await count()).toBe(before + 1);
    expect((await call(CPA_OFF, 'GET', `/contracts/${externalId}`)).status).toBe(403);
    expect((await call(CPA, 'POST', '/contracts/external', uploadForm(pdfBytes('cpa')))).status).toBe(403);
  });

  it('another business sees none of it', async () => {
    await run(env.DB, "INSERT OR IGNORE INTO businesses (id, name_en) VALUES (29, 'Second')");
    expect((await call(OWNER, 'GET', `/contracts/${externalId}`, undefined, 29)).status).toBeGreaterThanOrEqual(403);
    expect((await call(OWNER, 'POST', '/contracts/external', uploadForm(pdfBytes('b29')), 29)).status).toBeGreaterThanOrEqual(403);
  });

  it('void keeps it on record with its PDF', async () => {
    const res = await call(OWNER, 'POST', `/contracts/${externalId}/void`, { reason: 'Uploaded the wrong file' });
    expect(res.status).toBe(200);
    expect(res.body.contract.status).toBe('void');
    expect(res.body.contract.signedSha256).toBeTruthy();
    expect(res.body.contract.events.map((e: any) => e.kind)).toEqual(['uploaded', 'voided']);
    expect((await call(OWNER, 'GET', `/contracts/${externalId}/pdf?which=signed`)).status).toBe(200);
  });
});
