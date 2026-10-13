import { env } from 'cloudflare:workers';
import * as forgeModule from 'node-forge';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { all, first, run, todayIsrael } from '../../../src/core/db';
import { createApp } from '../../../src/index';
import { accessModule } from '../../../src/modules/access';
import { createBusinessesModule } from '../../../src/modules/businesses';
import { createClientsModule } from '../../../src/modules/clients';
import { createContractsModule, createContractsPublicModule, FakeContractPdfEngine, readFields, renderContract, type ContractsOptions, type FieldDef } from '../../../src/modules/contracts';
import { seedFor } from '../../../src/modules/contracts/seed';
import { combineFields } from '../../../src/modules/contracts/service';
import { ensureTermsDateRole } from '../../../src/modules/contracts/templates';
import { createDocumentsModule, type DocumentsModuleOptions } from '../../../src/modules/documents';
import { FakeFxHistory, FxRates } from '../../../src/modules/fx';
import { FakeMailer } from '../../../src/modules/sending';
import { RATES } from '../../fixtures/documents/rates';
import { pngDataUri, testPng } from '../../fixtures/contracts/png';

/**
 * R25b: the Standard Terms and a Work Order in one PDF, signed once. The included template's
 * columns and triggers, the terms date role, the combined field list, both parts in one PDF with
 * the work order on a new page, one signature in every box, and contracts without terms unchanged.
 */

const forge = (forgeModule as unknown as { default?: typeof forgeModule }).default ?? forgeModule;
function makeIdentity() {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2030-01-01T00:00:00Z');
  const subject = [{ name: 'commonName', value: 'Sample Business' }];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { SIGNING_KEY_PEM: forge.pki.privateKeyToPem(keys.privateKey), SIGNING_CERT_PEM: forge.pki.certificateToPem(cert) };
}

const OWNER = 'owner@example.com';
const TODAY = '2026-11-20';
const engine = new FakeContractPdfEngine();
const mailer = new FakeMailer();
const fakeSlack: typeof fetch = async () => new Response('ok');
const fx = new FxRates(env.DB, new FakeFxHistory(RATES));
const documentsOptions: DocumentsModuleOptions = { fx: () => fx, ceiling: { async check() {} }, today: () => TODAY };
const options: ContractsOptions = { documentsOptions, engineFor: () => engine, mailerFor: () => mailer, fetchFn: fakeSlack, now: () => new Date() };
const app = createApp({
  modules: [
    createClientsModule({ today: () => TODAY }),
    createDocumentsModule(documentsOptions),
    createBusinessesModule(documentsOptions),
    accessModule,
    createContractsModule(options),
    createContractsPublicModule(options),
  ],
});
let identity: { SIGNING_KEY_PEM: string; SIGNING_CERT_PEM: string };
const envFor = (email: string) => ({ ...env, ...identity, DEV_AUTH_EMAIL: email, PUBLIC_APP_URL: 'https://ledger.test' });

async function call(email: string, method: string, path: string, body?: unknown, businessId = 1) {
  const headers: Record<string, string> = { 'X-Business-Id': String(businessId), 'content-type': 'application/json' };
  const res = await app.request(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, envFor(email));
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // HTML
  }
  return { status: res.status, body: parsed, text };
}

async function ok(email: string, method: string, path: string, body?: unknown, businessId = 1) {
  const res = await call(email, method, path, body, businessId);
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${res.text}`);
  return res.body;
}

async function publicCall(url: string, method = 'GET', body?: unknown) {
  return app.request(
    url.replace('https://ledger.test', ''),
    { method, headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '84.229.1.2', 'User-Agent': 'Mozilla/5.0 (iPhone) Safari' }, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, ...identity, PUBLIC_APP_URL: 'https://ledger.test' },
  );
}

async function sqlError(sql: string, ...params: (string | number | null)[]) {
  try {
    await env.DB.prepare(sql).bind(...params).run();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const field = (f: Partial<FieldDef> & Pick<FieldDef, 'key' | 'kind'>): FieldDef => ({ labelEn: '', labelHe: '', required: false, options: [], multiple: false, allowOther: false, ...f });
const SIGNATURE = pngDataUri(testPng(60, 20, 10));

/** A contract-kind template: its own clause field, and the signature block a work order also prints. */
const TERMS = {
  name: 'Standard Terms',
  kind: 'contract',
  bodyEn: '# Standard Terms\n\nFor {{client_name}}. Governing place: {{terms_place}}.\n\n{{owner_signature}}\n\nName: {{signer_name}}, {{signer_role}}\n\n{{client_signature}}\n\nDate: {{client_date}}',
  bodyHe: '# תנאים כלליים\n\nעבור {{client_name}}. מקום: {{terms_place}}.\n\n{{owner_signature}}\n\nשם: {{signer_name}}, {{signer_role}}\n\n{{client_signature}}\n\nתאריך: {{client_date}}',
  fields: [
    field({ key: 'client_name', kind: 'client', source: 'name', labelEn: 'Client in the terms', required: true }),
    field({ key: 'terms_place', kind: 'owner_input', inputType: 'text', labelEn: 'Governing place', required: true }),
    field({ key: 'signer_name', kind: 'signer_input', inputType: 'name', labelEn: 'Your name', required: true }),
    field({ key: 'signer_role', kind: 'signer_input', inputType: 'role', labelEn: 'Your role', required: true }),
    field({ key: 'owner_signature', kind: 'signature', party: 'owner', labelEn: 'Our signature', required: true }),
    field({ key: 'client_signature', kind: 'signature', party: 'client', labelEn: 'Client signature', required: true }),
    field({ key: 'client_date', kind: 'signed_date', party: 'client', labelEn: 'Date' }),
  ],
};

/** A work order with a terms date field. client_name clashes with the terms on purpose. */
const WORK_ORDER = {
  name: 'Work Order',
  kind: 'work_order',
  bodyEn: '# Work Order\n\nClient: {{client_name}}. Standard Terms signed on {{terms_signed_date}}.\n\nFee {{fee}} from {{start}}.\n\n{{owner_signature}}\n\nName: {{signer_name}}\n\n{{client_signature}}\n\nDate: {{client_date}}',
  bodyHe: '# הזמנת עבודה\n\nלקוח: {{client_name}}. תנאים נחתמו ב-{{terms_signed_date}}.\n\nמחיר {{fee}} החל מ-{{start}}.\n\n{{owner_signature}}\n\nשם: {{signer_name}}\n\n{{client_signature}}\n\nתאריך: {{client_date}}',
  fields: [
    field({ key: 'client_name', kind: 'client', source: 'name', labelEn: 'Client in the work order', required: true }),
    field({ key: 'terms_signed_date', kind: 'owner_input', inputType: 'date', labelEn: 'Terms signed on', required: true, role: 'terms_date' }),
    field({ key: 'fee', kind: 'owner_input', inputType: 'money', labelEn: 'Fee', required: true, mapsTo: 'amount' }),
    field({ key: 'start', kind: 'owner_input', inputType: 'date', labelEn: 'Start', mapsTo: 'start_date' }),
    field({ key: 'signer_name', kind: 'signer_input', inputType: 'name', labelEn: 'Signer name', required: true }),
    field({ key: 'owner_signature', kind: 'signature', party: 'owner', labelEn: 'Our signature', required: true }),
    field({ key: 'client_signature', kind: 'signature', party: 'client', labelEn: 'Client signature', required: true }),
    field({ key: 'client_date', kind: 'signed_date', party: 'client', labelEn: 'Date' }),
  ],
};

let clientId = 0;
let termsId = 0;
let workOrderId = 0;
const woValues = { fee: { amountMinor: 1200000, currency: 'ILS' }, start: '2026-12-01', terms_place: 'Tel Aviv' };

async function combinedDraft(extra: Record<string, unknown> = {}) {
  const res = await ok(OWNER, 'POST', '/contracts', {
    clientId,
    templateId: workOrderId,
    includeTemplateId: termsId,
    language: 'en',
    values: woValues,
    signer: { name: 'Dana Cohen', email: 'dana@acme.example' },
    ...extra,
  });
  return res.contract.id as number;
}

async function sendCombined(extra: Record<string, unknown> = {}) {
  const id = await combinedDraft(extra);
  const sent = await ok(OWNER, 'POST', `/contracts/${id}/send`, { channel: 'email' });
  return { id, url: sent.url as string };
}

function codeFromLastEmail(): string {
  return /(\d{6})/.exec(mailer.sent[mailer.sent.length - 1]!.text)![1]!;
}

async function storedPdf(id: number, which: 'sent' | 'signed'): Promise<Uint8Array> {
  const row = (await first<{ sent_pdf_r2_key: string; signed_pdf_r2_key: string }>(env.DB, 'SELECT sent_pdf_r2_key, signed_pdf_r2_key FROM contracts WHERE id = ?', id))!;
  const object = await env.FILES.get(which === 'sent' ? row.sent_pdf_r2_key : row.signed_pdf_r2_key);
  return new Uint8Array(await object!.arrayBuffer());
}

/** Every widget of every AcroForm field: its page and whether it carries an appearance. */
async function widgets(pdf: Uint8Array): Promise<{ name: string; page: number; hasAppearance: boolean }[]> {
  const doc = await PDFDocument.load(pdf);
  const pages = doc.getPages();
  const out: { name: string; page: number; hasAppearance: boolean }[] = [];
  for (const [f] of doc.catalog.getOrCreateAcroForm().getAllFields()) {
    const t = f.dict.lookup(PDFName.of('T'));
    const name = t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : '';
    const kids = f.dict.lookup(PDFName.of('Kids'));
    const list = kids instanceof PDFArray ? kids.asArray().map((k) => doc.context.lookup(k) as PDFDict) : [f.dict];
    for (const w of list) out.push({ name, page: pages.findIndex((p) => p.ref === w.get(PDFName.of('P'))), hasAppearance: w.lookup(PDFName.of('AP')) instanceof PDFDict });
  }
  return out;
}

beforeAll(async () => {
  identity = makeIdentity();
  await run(env.DB, "UPDATE businesses SET name_en = 'Sample Business', name_he = 'עסק לדוגמה', tax_id = '123456782', address_en = 'Tel Aviv', email = 'hello@sample.example' WHERE id = 1");
  await ok(OWNER, 'GET', '/businesses');
  await env.FILES.put('signature/r25b-owner.png', testPng(80, 30, 40), { httpMetadata: { contentType: 'image/png' } });
  await run(env.DB, "UPDATE businesses SET signature_r2_key = 'signature/r25b-owner.png' WHERE id = 1");
  clientId = (await ok(OWNER, 'POST', '/clients', { nameEn: 'Acme Ltd', nameHe: 'אקמה בע"מ', companyId: '515555555', country: 'IL', addressEn: '1 Rothschild Blvd', email: 'office@acme.example' })).client.id;
  termsId = (await ok(OWNER, 'POST', '/contracts/templates', TERMS)).template.id;
  workOrderId = (await ok(OWNER, 'POST', '/contracts/templates', WORK_ORDER)).template.id;
});

describe('task 1: the included template columns and triggers', () => {
  it('included_template_id and included_template_version refuse a change after send', async () => {
    const { id } = await sendCombined();
    const row = (await first<{ included_template_id: number; included_template_version: number }>(env.DB, 'SELECT included_template_id, included_template_version FROM contracts WHERE id = ?', id))!;
    expect(row).toEqual({ included_template_id: termsId, included_template_version: 1 });
    expect(await sqlError('UPDATE contracts SET included_template_version = 9 WHERE id = ?', id)).toContain('contract_fixed');
    expect(await sqlError('UPDATE contracts SET included_template_id = NULL WHERE id = ?', id)).toContain('contract_fixed');
  });

  it('a draft can change or drop its included template', async () => {
    const id = await combinedDraft();
    await run(env.DB, 'UPDATE contracts SET included_template_id = NULL, included_template_version = NULL WHERE id = ?', id);
    await run(env.DB, 'UPDATE contracts SET included_template_id = ?, included_template_version = 1 WHERE id = ?', termsId, id);
  });

  it('the included template belongs to the same business, on insert and on update', async () => {
    const b2 = (await ok(OWNER, 'POST', '/businesses', { entityType: 'company', nameEn: 'Second Company Ltd', nameHe: 'חברה שנייה בע"מ', taxId: '515555555', addressEn: 'Haifa' })).businessId;
    const c2 = (await ok(OWNER, 'POST', '/clients', { nameEn: 'B2 Client', country: 'IL' }, b2)).client.id;
    const wo2 = (await ok(OWNER, 'POST', '/contracts/templates', WORK_ORDER, b2)).template.id;
    expect(
      await sqlError(
        "INSERT INTO contracts (business_id, client_id, template_id, template_version, included_template_id, included_template_version, kind, title) VALUES (?, ?, ?, 1, ?, 1, 'work_order', 'x')",
        b2,
        c2,
        wo2,
        termsId,
      ),
    ).toContain('business_mismatch');
    const draft = (await ok(OWNER, 'POST', '/contracts', { clientId: c2, templateId: wo2, values: {} }, b2)).contract.id;
    expect(await sqlError('UPDATE contracts SET included_template_id = ?, included_template_version = 1 WHERE id = ?', termsId, draft)).toContain('business_mismatch');
    expect((await call(OWNER, 'POST', '/contracts', { clientId: c2, templateId: wo2, includeTemplateId: termsId, values: {} }, b2)).status).toBe(404);
  });
});

describe('task 2: the terms date role', () => {
  it('the neutral Work Order marks terms_signed_date', () => {
    const sample = seedFor(2).templates.find((t) => t.kind === 'work_order')!;
    expect(sample.fields.find((f) => f.key === 'terms_signed_date')!.role).toBe('terms_date');
    expect(sample.bodyEn).toContain('{{terms_signed_date}}');
    expect(sample.bodyHe).toContain('{{terms_signed_date}}');
  });

  it('a template refuses the role on a field that is not a date the owner fills, and two terms dates', async () => {
    const bad = { ...WORK_ORDER, name: 'Bad', fields: WORK_ORDER.fields.map((f) => (f.key === 'start' ? { ...f, role: 'terms_date' } : f)) };
    expect((await call(OWNER, 'POST', '/contracts/templates', bad)).status).toBe(400);
    const wrongKind = { ...WORK_ORDER, name: 'Bad 2', fields: WORK_ORDER.fields.map((f) => (f.key === 'fee' ? { ...f, role: 'terms_date' } : f)) };
    expect((await call(OWNER, 'POST', '/contracts/templates', wrongKind)).status).toBe(400);
  });

  it('existing businesses: the role is set in place on an unused version, and on a new version once a sent contract uses it', async () => {
    const plain = WORK_ORDER.fields.map(({ role: _role, ...f }) => f);
    const unused = (await ok(OWNER, 'POST', '/contracts/templates', { ...WORK_ORDER, name: 'Old WO unused', fields: plain })).template.id;
    const used = (await ok(OWNER, 'POST', '/contracts/templates', { ...WORK_ORDER, name: 'Old WO used', fields: plain })).template.id;
    const draft = (await ok(OWNER, 'POST', '/contracts', { clientId, templateId: used, values: { ...woValues, terms_signed_date: '2026-01-05' }, signer: { name: 'Dana', email: 'dana@acme.example' } })).contract.id;
    await ok(OWNER, 'POST', `/contracts/${draft}/send`, { channel: 'link' });
    await run(env.DB, "DELETE FROM settings WHERE key LIKE '%contracts.terms_date_role'");
    await ensureTermsDateRole(env.DB, 1);
    const versions = async (id: number) =>
      (await all<{ version: number; fields_json: string }>(env.DB, 'SELECT version, fields_json FROM contract_template_versions WHERE template_id = ? ORDER BY version', id)).map((v) => ({
        version: v.version,
        role: (JSON.parse(v.fields_json) as FieldDef[]).find((f) => f.key === 'terms_signed_date')!.role ?? null,
      }));
    expect(await versions(unused)).toEqual([{ version: 1, role: 'terms_date' }]);
    expect(await versions(used)).toEqual([
      { version: 1, role: null },
      { version: 2, role: 'terms_date' },
    ]);
    expect((await first<{ current_version: number }>(env.DB, 'SELECT current_version FROM contract_templates WHERE id = ?', used))!.current_version).toBe(2);
    // Runs once.
    await ensureTermsDateRole(env.DB, 1);
    expect((await versions(used)).length).toBe(2);
  });
});

describe('task 3: the combined field list', () => {
  it('the union by key, the work order wins a clash, the terms date becomes the signing date', () => {
    const fields = combineFields(WORK_ORDER.fields, TERMS.fields);
    expect(fields.map((f) => f.key)).toEqual(['client_name', 'terms_signed_date', 'fee', 'start', 'signer_name', 'owner_signature', 'client_signature', 'client_date', 'terms_place', 'signer_role']);
    expect(fields.find((f) => f.key === 'client_name')!.labelEn).toBe('Client in the work order');
    expect(fields.find((f) => f.key === 'signer_name')!.labelEn).toBe('Signer name');
    expect(fields.find((f) => f.key === 'terms_signed_date')).toMatchObject({ kind: 'signed_date', party: 'client', role: 'terms_date', required: false });
    // Without terms nothing changes.
    expect(combineFields(WORK_ORDER.fields, null)).toBe(WORK_ORDER.fields);
  });

  it('the new contract screen gets the combined fields, and only a work order includes a contract template', async () => {
    const d = await ok(OWNER, 'GET', `/contracts/new?clientId=${clientId}&templateId=${workOrderId}&includeTemplateId=${termsId}`);
    expect(d.includedTemplate).toEqual({ id: termsId, name: 'Standard Terms', version: 1 });
    expect(d.fields.map((f: FieldDef) => f.key)).toContain('terms_place');
    expect(d.fields.find((f: FieldDef) => f.key === 'terms_signed_date').kind).toBe('signed_date');
    const plain = await ok(OWNER, 'GET', `/contracts/new?clientId=${clientId}&templateId=${workOrderId}`);
    expect(plain.includedTemplate).toBeNull();
    expect(plain.fields.find((f: FieldDef) => f.key === 'terms_signed_date').kind).toBe('owner_input');
    expect((await call(OWNER, 'GET', `/contracts/new?clientId=${clientId}&templateId=${termsId}&includeTemplateId=${termsId}`)).status).toBe(400);
    expect((await call(OWNER, 'GET', `/contracts/new?clientId=${clientId}&templateId=${workOrderId}&includeTemplateId=${workOrderId}`)).status).toBe(400);
  });

  it('draft values, validation and send use the union: a terms field is required, the terms date is not', async () => {
    const id = await combinedDraft({ values: { ...woValues, terms_place: '', terms_signed_date: '2020-01-01' } });
    const detail = (await ok(OWNER, 'GET', `/contracts/${id}`)).contract;
    expect(detail.includedTemplate).toEqual({ id: termsId, name: 'Standard Terms', version: 1 });
    expect(detail.values.terms_signed_date).toBeUndefined();
    const res = await call(OWNER, 'POST', `/contracts/${id}/send`, { channel: 'link' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Governing place');
    expect(res.body.error.message).not.toContain('Terms signed on');
    await ok(OWNER, 'PUT', `/contracts/${id}`, { clientId, templateId: workOrderId, includeTemplateId: termsId, values: woValues, signer: { name: 'Dana Cohen', email: 'dana@acme.example' } });
    expect((await call(OWNER, 'POST', `/contracts/${id}/send`, { channel: 'link' })).status).toBe(200);
  });

  it('a sent contract locks the included template version too: an edit writes a new version', async () => {
    const t = (await ok(OWNER, 'POST', '/contracts/templates', { ...TERMS, name: 'Terms to edit' })).template;
    const id = await combinedDraft({ includeTemplateId: t.id });
    await ok(OWNER, 'POST', `/contracts/${id}/send`, { channel: 'link' });
    expect(await sqlError("UPDATE contract_template_versions SET body_en = 'changed' WHERE template_id = ? AND version = 1", t.id)).toContain('contract_fixed');
    const edited = (await ok(OWNER, 'PUT', `/contracts/templates/${t.id}`, { ...TERMS, name: 'Terms to edit', bodyEn: `${TERMS.bodyEn}\n\nNew clause.` })).template;
    expect(edited.version).toBe(2);
    expect(edited.usedCount).toBe(1);
    expect((await first<{ included_template_version: number }>(env.DB, 'SELECT included_template_version FROM contracts WHERE id = ?', id))!.included_template_version).toBe(1);
  });
});

describe('task 4: one PDF, terms first, the work order on a new page', () => {
  it('prints each part by the language rule: terms English, terms Hebrew, then the work order from a new page', () => {
    const { html } = renderContract({
      title: 'x',
      kind: 'work_order',
      language: 'both',
      bodyEn: WORK_ORDER.bodyEn,
      bodyHe: WORK_ORDER.bodyHe,
      included: { bodyEn: TERMS.bodyEn, bodyHe: TERMS.bodyHe },
      fields: combineFields(WORK_ORDER.fields, TERMS.fields),
      values: {},
      identity: { nameEn: 'Sample Business', nameHe: '' },
      mode: 'pdf',
    });
    const at = (s: string) => html.indexOf(s);
    expect(at('<h1>Standard Terms</h1>')).toBeGreaterThan(0);
    expect(at('<h1>Standard Terms</h1>')).toBeLessThan(at('<h1>תנאים כלליים</h1>'));
    expect(at('<h1>תנאים כלליים</h1>')).toBeLessThan(at('class="body part-break" dir="ltr" lang="en"'));
    expect(at('class="body part-break" dir="ltr" lang="en"')).toBeLessThan(at('<h1>Work Order</h1>'));
    expect(at('<h1>Work Order</h1>')).toBeLessThan(at('<h1>הזמנת עבודה</h1>'));
    expect(html.match(/part-break/g)!.length).toBe(2); // the CSS rule and the one section
    expect(html).toContain('break-before: page');
  });

  it('a contract without terms renders the same HTML as before', () => {
    const input = {
      title: 'x',
      kind: 'work_order' as const,
      language: 'both' as const,
      bodyEn: WORK_ORDER.bodyEn,
      bodyHe: WORK_ORDER.bodyHe,
      fields: WORK_ORDER.fields,
      values: {},
      identity: { nameEn: 'Sample Business', nameHe: '' },
      mode: 'pdf' as const,
    };
    const before = renderContract(input).html;
    expect(renderContract({ ...input, included: null }).html).toBe(before);
    expect(before).not.toContain('part-break');
  });

  it('the sent PDF holds both parts, the work order from a new page, one field with a widget per place', async () => {
    const { id } = await sendCombined({ ownerSign: true });
    const pdf = await storedPdf(id, 'sent');
    const w = await widgets(pdf);
    const pageOf = (name: string) => w.filter((x) => x.name === name).map((x) => x.page);
    expect(Math.max(...pageOf('terms_place'))).toBeLessThan(Math.min(...pageOf('fee')));
    expect(pageOf('client_signature').length).toBe(2);
    expect(pageOf('owner_signature').length).toBe(2);
    expect(pageOf('signer_name').length).toBe(2);
    expect(new Set(pageOf('client_signature')).size).toBe(2); // one box in each part
    // The owner signed at send: every owner box shows it. Client boxes stay empty.
    expect(w.filter((x) => x.name === 'owner_signature').every((x) => x.hasAppearance)).toBe(true);
    expect(w.filter((x) => x.name === 'client_signature').some((x) => x.hasAppearance)).toBe(false);
    // The terms date stays open for signing.
    const fields = await readFields(pdf);
    expect(fields.find((f) => f.name === 'terms_signed_date')).toMatchObject({ readOnly: false, value: '' });
    expect(fields.find((f) => f.name === 'terms_place')).toMatchObject({ readOnly: true, value: 'Tel Aviv' });
  });

  it('the preview shows both parts', async () => {
    const res = await call(OWNER, 'POST', '/contracts/preview', { clientId, templateId: workOrderId, includeTemplateId: termsId, language: 'en', values: woValues, signer: { name: 'Dana Cohen' } });
    expect(res.status).toBe(200);
    expect(res.text).toContain('<h1>Standard Terms</h1>');
    expect(res.text).toContain('<h1>Work Order</h1>');
    expect(res.text).toContain('part-break');
  });
});

describe('task 5: signing once', () => {
  let signedId = 0;

  it('before signing, the PDF and the web view show a Sign button in every client box of both parts', async () => {
    const { url } = await sendCombined();
    const viewed = await PDFDocument.load(new Uint8Array(await (await publicCall(`${url}/pdf`)).arrayBuffer()));
    let buttons = 0;
    for (const page of viewed.getPages()) {
      const annots = page.node.Annots();
      for (let i = 0; i < (annots?.size() ?? 0); i++) {
        const a = annots!.lookup(i) as PDFDict;
        const uri = (a.lookup(PDFName.of('A')) as PDFDict | undefined)?.lookup(PDFName.of('URI'));
        if (uri instanceof PDFString && uri.decodeText().endsWith('#signature')) buttons++;
      }
    }
    expect(buttons).toBe(2);
    const html = await (await publicCall(`${url}/view`)).text();
    expect(html.match(/class="f f-sig sign-btn"/g)!.length).toBe(2);
    expect(html).toContain('<h1>Standard Terms</h1>');
    expect(html).toContain('<h1>Work Order</h1>');
    // The signing page asks for the signer inputs of both parts.
    const page = await (await publicCall(url)).text();
    expect(page).toContain('data-key="signer_name"');
    expect(page).toContain('data-key="signer_role"');
  });

  it('one signature lands in every client box, the owner signature in every owner box, the terms date is the signing date', async () => {
    const { id, url } = await sendCombined({ ownerSign: true });
    signedId = id;
    await publicCall(url);
    await publicCall(`${url}/code`, 'POST');
    const res = await publicCall(`${url}/sign`, 'POST', { values: { signer_name: 'Dana Cohen', signer_role: 'CEO' }, code: codeFromLastEmail(), signaturePng: SIGNATURE, consent: true });
    expect(res.status).toBe(200);
    const pdf = await storedPdf(id, 'signed');
    const w = await widgets(pdf);
    expect(w.filter((x) => x.name === 'client_signature').length).toBe(2);
    expect(w.filter((x) => x.name === 'client_signature').every((x) => x.hasAppearance)).toBe(true);
    expect(w.filter((x) => x.name === 'owner_signature').length).toBe(2);
    expect(w.filter((x) => x.name === 'owner_signature').every((x) => x.hasAppearance)).toBe(true);
    const fields = await readFields(pdf);
    const [y, m, d] = todayIsrael().split('-');
    expect(fields.find((f) => f.name === 'terms_signed_date')).toMatchObject({ readOnly: true, value: `${d}/${m}/${y}` });
    expect(fields.find((f) => f.name === 'client_date')!.value).toBe(`${d}/${m}/${y}`);
    expect(fields.find((f) => f.name === 'signer_role')!.value).toBe('CEO');
  });

  it('the evidence page and the Signed by event name both templates', async () => {
    const finalHtml = engine.renders[engine.renders.length - 1]!;
    expect(finalHtml).toContain('Work Order, version 1');
    expect(finalHtml).toContain('<th>Included template</th><td>Standard Terms, version 1</td>');
    expect(finalHtml.match(/Evidence of signing/g)!.length).toBe(1);
    expect(finalHtml).toContain('Signed by Dana Cohen, CEO · Work Order v1 and Standard Terms v1');
    const detail = (await ok(OWNER, 'GET', `/contracts/${signedId}`)).contract;
    expect(detail.templateName).toBe('Work Order + Standard Terms');
    expect(detail.events.find((e: any) => e.kind === 'signed').label).toMatch(/^Signed by Dana Cohen, CEO · Work Order v1 and Standard Terms v1 · final hash/);
    const { contracts } = await ok(OWNER, 'GET', `/contracts/clients/${clientId}`);
    expect(contracts.find((c: any) => c.id === signedId).templateName).toBe('Work Order + Standard Terms');
  });

  it('task 7: create pro forma from a combined work order uses the work order fields', async () => {
    const pf = await ok(OWNER, 'POST', `/contracts/${signedId}/proforma`, {});
    const doc = await ok(OWNER, 'GET', `/documents/${pf.documentId}`);
    expect(doc.document.type).toBe('300');
    expect(doc.document.status).toBe('draft');
    const lines = doc.lines ?? doc.document.lines;
    expect(lines.map((l: any) => l.unit_price_minor ?? l.unitPriceMinor)).toEqual([1200000]);
  });

  it('a contract without terms still signs with its own fields and evidence, as before', async () => {
    const id = (
      await ok(OWNER, 'POST', '/contracts', { clientId, templateId: workOrderId, language: 'en', values: { ...woValues, terms_signed_date: '2026-01-05' }, signer: { name: 'Dana Cohen', email: 'dana@acme.example' } })
    ).contract.id;
    const sent = await ok(OWNER, 'POST', `/contracts/${id}/send`, { channel: 'email' });
    await publicCall(sent.url);
    await publicCall(`${sent.url}/code`, 'POST');
    const res = await publicCall(`${sent.url}/sign`, 'POST', { values: { signer_name: 'Dana Cohen' }, code: codeFromLastEmail(), signaturePng: SIGNATURE, consent: true });
    expect(res.status).toBe(200);
    const finalHtml = engine.renders[engine.renders.length - 1]!;
    expect(finalHtml).not.toContain('Included template');
    expect(finalHtml).not.toContain('part-break');
    expect(finalHtml).toContain('<b>Signed by Dana Cohen</b>');
    const fields = await readFields(await storedPdf(id, 'signed'));
    expect(fields.find((f) => f.name === 'terms_signed_date')!.value).toBe('05/01/2026');
    expect((await widgets(await storedPdf(id, 'signed'))).filter((x) => x.name === 'client_signature').length).toBe(1);
    expect((await ok(OWNER, 'GET', `/contracts/${id}`)).contract.templateName).toBe('Work Order');
  });
});
