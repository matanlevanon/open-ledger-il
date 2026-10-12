import { env } from 'cloudflare:workers';
import * as forgeModule from 'node-forge';
import { PDFDocument, PDFName } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { all, first, run } from '../../../src/core/db';
import { createApp } from '../../../src/index';
import { accessModule } from '../../../src/modules/access';
import { createBusinessesModule } from '../../../src/modules/businesses';
import { createClientsModule } from '../../../src/modules/clients';
import {
  contractLines,
  contractsCron,
  createContractsModule,
  createContractsPublicModule,
  FakeContractPdfEngine,
  readFields,
  renderContract,
  type ContractsOptions,
  type FieldDef,
} from '../../../src/modules/contracts';
import { createDocumentsModule, type DocumentsModuleOptions } from '../../../src/modules/documents';
import { FakeFxHistory, FxRates } from '../../../src/modules/fx';
import { FakeMailer } from '../../../src/modules/sending';
import { signSendToken } from '../../../src/modules/sending/tokens';
import { verifyPdf } from '../../../src/modules/signing';
import { RATES } from '../../fixtures/documents/rates';
import { pngDataUri, testPng } from '../../fixtures/contracts/png';

/**
 * R25: contracts and work orders, Fill & Sign. Template versioning, prefill, the scope picker,
 * AcroForm fields, Hebrew layout, the signed link, the email code, sign and decline, the final
 * certificate signature, immutability triggers, roles, business isolation, pro forma and the cron.
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
const ASSISTANT = 'noauto-r25-assistant@example.com';
const CPA = 'noauto-r25-cpa@example.com';
const CPA_OFF = 'noauto-r25-cpa-off@example.com';
const TODAY = '2026-11-20';

let offsetMs = 0;
const clock = () => new Date(Date.now() + offsetMs);
const engine = new FakeContractPdfEngine();
const mailer = new FakeMailer();
let mailOn = true;
const slack: string[] = [];
const fakeSlack: typeof fetch = async (_input, init) => {
  slack.push(JSON.parse(String(init?.body)).text);
  return new Response('ok');
};
const fx = new FxRates(env.DB, new FakeFxHistory(RATES));
const documentsOptions: DocumentsModuleOptions = { fx: () => fx, ceiling: { async check() {} }, today: () => TODAY };
const options: ContractsOptions = { documentsOptions, engineFor: () => engine, mailerFor: () => (mailOn ? mailer : null), fetchFn: fakeSlack, now: clock };
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

/** The public signing link, as the client opens it: no session, a browser user agent. */
async function publicCall(url: string, method = 'GET', body?: unknown) {
  const path = url.replace('https://ledger.test', '');
  const res = await app.request(
    path,
    { method, headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '84.229.1.2', 'User-Agent': 'Mozilla/5.0 (iPhone) Safari' }, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, ...identity, PUBLIC_APP_URL: 'https://ledger.test', SLACK_WEBHOOK_URL: 'https://hooks.slack.test/r25' },
  );
  return res;
}

const SIGNATURE = pngDataUri(testPng(60, 20, 10));
const BILINGUAL_FIELDS: FieldDef[] = [
  { key: 'client_name', kind: 'client', source: 'name', labelEn: 'Client', labelHe: 'לקוח', required: true, options: [], multiple: false, allowOther: false },
  { key: 'business_name', kind: 'business', source: 'name', labelEn: 'Business', labelHe: 'עסק', required: true, options: [], multiple: false, allowOther: false },
  { key: 'scope_text', kind: 'owner_input', inputType: 'multiline', labelEn: 'Scope', labelHe: 'היקף', required: true, options: [], multiple: false, allowOther: false, mapsTo: 'description' },
  { key: 'fee', kind: 'owner_input', inputType: 'money', labelEn: 'Fee', labelHe: 'מחיר', required: true, options: [], multiple: false, allowOther: false, mapsTo: 'amount' },
  { key: 'start', kind: 'owner_input', inputType: 'date', labelEn: 'Start', labelHe: 'התחלה', required: false, options: [], multiple: false, allowOther: false, mapsTo: 'start_date' },
  { key: 'signer_name', kind: 'signer_input', inputType: 'name', labelEn: 'Your name', labelHe: 'שמך', required: true, options: [], multiple: false, allowOther: false },
  { key: 'signer_role', kind: 'signer_input', inputType: 'role', labelEn: 'Your role', labelHe: 'תפקידך', required: false, options: [], multiple: false, allowOther: false },
  { key: 'owner_signature', kind: 'signature', party: 'owner', labelEn: 'Our signature', labelHe: 'חתימתנו', required: true, options: [], multiple: false, allowOther: false },
  { key: 'client_signature', kind: 'signature', party: 'client', labelEn: 'Client signature', labelHe: 'חתימת הלקוח', required: true, options: [], multiple: false, allowOther: false },
  { key: 'client_date', kind: 'signed_date', party: 'client', labelEn: 'Date', labelHe: 'תאריך', required: false, options: [], multiple: false, allowOther: false },
];
const BILINGUAL = {
  name: 'Bilingual services agreement',
  kind: 'contract',
  bodyEn: 'Between {{business_name}} and {{client_name}}.\n\n**Scope:** {{scope_text}}\n\nFee {{fee}} from {{start}}.\n\n{{owner_signature}}\n\nName: {{signer_name}}, {{signer_role}}\n\n{{client_signature}}\n\nDate: {{client_date}}',
  bodyHe: 'בין {{business_name}} לבין {{client_name}}.\n\n**היקף:** {{scope_text}}\n\nמחיר {{fee}} החל מ-{{start}}.\n\n{{owner_signature}}\n\nשם: {{signer_name}}, {{signer_role}}\n\n{{client_signature}}\n\nתאריך: {{client_date}}',
  fields: BILINGUAL_FIELDS,
};

let clientId = 0;
let bilingualId = 0;
let workOrderId = 0;

async function newContract(templateId: number, values: Record<string, unknown>, extra: Record<string, unknown> = {}, email = OWNER) {
  const res = await ok(email, 'POST', '/contracts', {
    clientId,
    templateId,
    language: 'both',
    values,
    signer: { name: 'Dana Cohen', email: 'dana@acme.example', phone: '050-1234567' },
    ...extra,
  });
  return res.contract.id as number;
}

const bilingualValues = { scope_text: 'ייעוץ שיווקי, Fractional CMO', fee: { amountMinor: 3200000, currency: 'ILS' }, start: '2026-12-01' };

async function sentBilingual(extra: Record<string, unknown> = {}) {
  const id = await newContract(bilingualId, bilingualValues, extra);
  const sent = await ok(OWNER, 'POST', `/contracts/${id}/send`, { channel: mailOn ? 'email' : 'link' });
  return { id, url: sent.url as string, sent };
}

function codeFromLastEmail(): string {
  const last = mailer.sent[mailer.sent.length - 1]!;
  return /(\d{6})/.exec(last.text)![1]!;
}

async function storedPdf(id: number, which: 'sent' | 'signed'): Promise<Uint8Array> {
  const row = (await first<{ sent_pdf_r2_key: string; signed_pdf_r2_key: string }>(env.DB, 'SELECT sent_pdf_r2_key, signed_pdf_r2_key FROM contracts WHERE id = ?', id))!;
  const object = await env.FILES.get(which === 'sent' ? row.sent_pdf_r2_key : row.signed_pdf_r2_key);
  return new Uint8Array(await object!.arrayBuffer());
}

async function sqlError(sql: string, ...params: (string | number | null)[]) {
  try {
    await env.DB.prepare(sql).bind(...params).run();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

beforeAll(async () => {
  identity = makeIdentity();
  await run(env.DB, "UPDATE businesses SET name_en = 'Sample Business', name_he = 'עסק לדוגמה', tax_id = '123456782', address_en = 'Tel Aviv', email = 'hello@sample.example' WHERE id = 1");
  await ok(OWNER, 'GET', '/businesses');
  const sig = testPng(80, 30, 40);
  await env.FILES.put('signature/r25-owner.png', sig, { httpMetadata: { contentType: 'image/png' } });
  await run(env.DB, "UPDATE businesses SET signature_r2_key = 'signature/r25-owner.png' WHERE id = 1");
  expect((await call(OWNER, 'POST', '/access/users', { email: ASSISTANT, role: 'assistant' })).status).toBe(201);
  expect((await call(OWNER, 'POST', '/access/users', { email: CPA, accessEndsOn: '2027-12-31', features: { contracts: true } })).status).toBe(201);
  expect((await call(OWNER, 'POST', '/access/users', { email: CPA_OFF, accessEndsOn: '2027-12-31' })).status).toBe(201);
  const client = await ok(OWNER, 'POST', '/clients', { nameEn: 'Acme Ltd', nameHe: 'אקמה בע"מ', companyId: '515555555', country: 'IL', addressEn: '1 Rothschild Blvd', email: 'office@acme.example' });
  clientId = client.client.id;
  bilingualId = (await ok(OWNER, 'POST', '/contracts/templates', BILINGUAL)).template.id;
});

describe('seeded templates (every business starts with the neutral sample)', () => {
  it('seeds the sample agreement and the sample work order, and no services', async () => {
    const { templates } = await ok(OWNER, 'GET', '/contracts/templates');
    expect(templates.map((t: any) => t.name)).toEqual(expect.arrayContaining(['Sample agreement', 'Sample work order']));
    workOrderId = templates.find((t: any) => t.name === 'Sample work order').id;
    expect((await ok(OWNER, 'GET', '/contracts/services')).services).toEqual([]);
    await ok(OWNER, 'GET', '/contracts/templates');
    expect((await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM contract_templates WHERE business_id = 1 AND name = 'Sample work order'"))!.n).toBe(1);
  });

  it('the owner adds services with scope items', async () => {
    await ok(OWNER, 'POST', '/contracts/services', {
      nameEn: 'Diagnostic',
      model: 'fixed_fee',
      descriptionEn: 'A one-time review.',
      items: ['Intake review', 'Interviews', 'Findings', 'Plan', 'Readout'].map((labelEn) => ({ labelEn })),
    });
    const { services } = await ok(OWNER, 'POST', '/contracts/services', { nameEn: 'Retainer', model: 'monthly_retainer', items: [{ labelEn: 'Monthly sessions' }, { labelEn: 'Biweekly sessions' }] });
    expect(services.map((s: any) => s.nameEn)).toEqual(['Diagnostic', 'Retainer']);
    expect(services[0].items).toHaveLength(5);
  });
});

describe('templates', () => {
  it('refuses a body token with no field', async () => {
    const res = await call(OWNER, 'POST', '/contracts/templates', { name: 'Broken', kind: 'contract', bodyEn: 'Hello {{missing}}', fields: [] });
    expect(res.status).toBe(400);
  });

  it('template versioning: edits change the version in place until a sent contract uses it, then write a new version', async () => {
    const t = (await ok(OWNER, 'POST', '/contracts/templates', { ...BILINGUAL, name: 'Versioned' })).template;
    const edited = (await ok(OWNER, 'PUT', `/contracts/templates/${t.id}`, { ...BILINGUAL, name: 'Versioned', bodyEn: `${BILINGUAL.bodyEn}\n\nEdit one.` })).template;
    expect(edited.version).toBe(1);
    const id = await newContract(t.id, bilingualValues);
    await ok(OWNER, 'POST', `/contracts/${id}/send`, { channel: 'link' });
    const after = (await ok(OWNER, 'PUT', `/contracts/templates/${t.id}`, { ...BILINGUAL, name: 'Versioned', bodyEn: `${BILINGUAL.bodyEn}\n\nEdit two.` })).template;
    expect(after.version).toBe(2);
    expect(after.usedCount).toBe(1);
    const row = await first<{ template_version: number }>(env.DB, 'SELECT template_version FROM contracts WHERE id = ?', id);
    expect(row!.template_version).toBe(1);
    expect(await sqlError("UPDATE contract_template_versions SET body_en = 'changed' WHERE template_id = ? AND version = 1", t.id)).toContain('contract_fixed');
    expect(await sqlError('DELETE FROM contract_template_versions WHERE template_id = ?', t.id)).toContain('append_only');
  });

  it('only the owner manages templates and services', async () => {
    expect((await call(ASSISTANT, 'POST', '/contracts/templates', BILINGUAL)).status).toBe(403);
    expect((await call(ASSISTANT, 'POST', '/contracts/services', { nameEn: 'X' })).status).toBe(403);
    expect((await call(ASSISTANT, 'GET', '/contracts/templates')).status).toBe(200);
    expect((await call(CPA, 'GET', '/contracts/templates')).status).toBe(403);
  });
});

describe('create and send', () => {
  it('field prefill: client and business fields and defaults come filled', async () => {
    const { templates } = await ok(OWNER, 'GET', '/contracts/templates');
    const st = templates.find((t: any) => t.name === 'Sample agreement');
    const d = await ok(OWNER, 'GET', `/contracts/new?clientId=${clientId}&templateId=${st.id}`);
    expect(d.values.client_name).toBe('Acme Ltd');
    expect(d.values.client_tax_id).toBe('515555555');
    expect(d.values.business_name).toBe('Sample Business');
    expect(d.ownerSignature).toBe(true);
  });

  it('a value typed for this contract wins over the client record, the client stays unchanged', async () => {
    const id = await newContract(bilingualId, { ...bilingualValues, client_name: 'Acme Israel Ltd' });
    const detail = (await ok(OWNER, 'GET', `/contracts/${id}`)).contract;
    expect(detail.values.client_name).toBe('Acme Israel Ltd');
    expect((await first<{ name_en: string }>(env.DB, 'SELECT name_en FROM clients WHERE id = ?', clientId))!.name_en).toBe('Acme Ltd');
  });

  it('refuses to send with a required field empty', async () => {
    const id = await newContract(bilingualId, { scope_text: '' });
    const res = await call(OWNER, 'POST', `/contracts/${id}/send`, { channel: 'link' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Scope');
  });

  it('the preview is the PDF HTML with tinted field boxes and the owner signature', async () => {
    const res = await call(OWNER, 'POST', '/contracts/preview', { clientId, templateId: bilingualId, language: 'both', values: bilingualValues, signer: { name: 'Dana Cohen' }, ownerSign: true });
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="https://field.ledger.invalid/scope_text"');
    expect(res.text).toContain('pointer-events: none');
    expect(res.text).toContain('data:image/png;base64');
    expect(res.text).toContain('Dana Cohen');
  });

  it('send stores the PDF write-once, freezes the values and emails a 14-day link', async () => {
    const before = mailer.sent.length;
    const { id, url, sent } = await sentBilingual({ ownerSign: true });
    expect(url).toMatch(/^https:\/\/ledger\.test\/api\/sending\/public\/c\//);
    expect(sent.emailed).toBe(true);
    expect(mailer.sent.length).toBe(before + 1);
    expect(mailer.sent[before]!.to).toBe('dana@acme.example');
    const row = (await first<any>(env.DB, 'SELECT * FROM contracts WHERE id = ?', id))!;
    expect(row.status).toBe('sent');
    expect(row.sent_pdf_r2_key).toBe(`business/1/contracts/${row.sent_pdf_sha256}.pdf`);
    expect(Math.round((Date.parse(row.expires_at) - Date.parse(row.sent_at)) / 86400000)).toBe(14);
    expect(row.owner_signed_at).not.toBeNull();
    const kinds = (await all<{ kind: string }>(env.DB, 'SELECT kind FROM contract_events WHERE contract_id = ? ORDER BY id', id)).map((e) => e.kind);
    expect(kinds).toEqual(['created', 'owner_signed', 'sent']);
    expect(await sqlError("UPDATE contracts SET field_values_json = '{}' WHERE id = ?", id)).toContain('contract_fixed');
    expect((await call(OWNER, 'PUT', `/contracts/${id}`, { clientId, templateId: bilingualId, values: {} })).status).toBe(409);
  });

  it('the PDF has AcroForm fields with the right names and values, owner fields locked, signer fields open', async () => {
    const { id } = await sentBilingual({ ownerSign: true });
    const fields = await readFields(await storedPdf(id, 'sent'));
    const byName = new Map(fields.map((f) => [f.name, f]));
    expect(byName.get('scope_text')).toMatchObject({ type: 'text', value: 'ייעוץ שיווקי, Fractional CMO', readOnly: true, widgets: 2 });
    expect(byName.get('fee')).toMatchObject({ value: '₪32,000.00', readOnly: true });
    expect(byName.get('client_name')).toMatchObject({ value: 'Acme Ltd', readOnly: true });
    expect(byName.get('signer_name')).toMatchObject({ type: 'text', readOnly: false });
    expect(byName.get('owner_signature')).toMatchObject({ type: 'signature', readOnly: true, hasAppearance: true });
    expect(byName.get('client_signature')).toMatchObject({ type: 'signature', readOnly: false, hasAppearance: false });
    // The field links are gone from the pages.
    const doc = await PDFDocument.load(await storedPdf(id, 'sent'));
    for (const page of doc.getPages()) {
      const annots = page.node.Annots()?.asArray() ?? [];
      for (const a of annots) expect(String(doc.context.lookup(a))).not.toContain('field.ledger.invalid');
    }
  });

  it('remind re-sends the same link and logs it', async () => {
    const { id, url } = await sentBilingual();
    const reminded = await ok(OWNER, 'POST', `/contracts/${id}/remind`, { channel: 'email' });
    expect(reminded.url).toBe(url);
    expect(mailer.sent[mailer.sent.length - 1]!.subject).toContain('Reminder');
    expect((await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM contract_events WHERE contract_id = ? AND kind = 'reminded'", id))!.n).toBe(1);
  });
});

describe('Hebrew and mixed text', () => {
  it('a Hebrew value and a mixed Hebrew and English value lay out right to left', () => {
    const { html, boxes } = renderContract({
      title: 'הסכם',
      kind: 'contract',
      language: 'both',
      bodyEn: BILINGUAL.bodyEn,
      bodyHe: BILINGUAL.bodyHe,
      fields: BILINGUAL_FIELDS,
      values: { client_name: 'אקמה בע"מ', business_name: 'Sample Business', scope_text: 'ייעוץ שיווקי, Fractional CMO', fee: { amountMinor: 100, currency: 'ILS' } },
      identity: { nameEn: 'Sample Business', nameHe: 'עסק לדוגמה' },
      mode: 'pdf',
    });
    // The Hebrew body is a right-to-left section. Every value isolates its own direction.
    expect(html).toContain('<section class="body" dir="rtl" lang="he">');
    expect(html).toMatch(/<a class="f [^"]*" dir="auto" href="https:\/\/field\.ledger\.invalid\/client_name">אקמה בע&quot;מ<\/a>/);
    expect(html).toMatch(/dir="auto" href="https:\/\/field\.ledger\.invalid\/scope_text">ייעוץ שיווקי, Fractional CMO<\/a>/);
    expect(html).toContain('unicode-bidi: isolate');
    expect(boxes.find((b) => b.name === 'client_name')!.value).toBe('אקמה בע"מ');
  });

  it('Hebrew and mixed values survive in the PDF fields as UTF-16', async () => {
    const id = await newContract(bilingualId, { ...bilingualValues, client_name: 'אקמה בע"מ' }, { language: 'he' });
    await ok(OWNER, 'POST', `/contracts/${id}/send`, { channel: 'link' });
    const fields = await readFields(await storedPdf(id, 'sent'));
    expect(fields.find((f) => f.name === 'client_name')!.value).toBe('אקמה בע"מ');
    expect(fields.find((f) => f.name === 'scope_text')!.value).toBe('ייעוץ שיווקי, Fractional CMO');
    expect(engine.renders[engine.renders.length - 1]).toContain('<html lang="he">');
  });
});

describe('the scope picker', () => {
  let services: any[] = [];
  let scopeContract = 0;

  it('prints only the ticked services and items, with Other text and a note, and one fee row per service', async () => {
    services = (await ok(OWNER, 'GET', '/contracts/services')).services;
    const [mc, adv] = [services[0], services[1]];
    const values = {
      work_order_number: 'WO-1',
      work_order_date: '2026-11-20',
      terms_signed_date: '2026-11-01',
      start_date: '2026-12-01',
      decision_maker: 'Dana Cohen, CEO, dana@acme.example',
      term: { selected: [{ value: 'minimum', text: '6' }] },
      billing: { selected: [{ value: 'monthly_advance' }] },
      scope: {
        services: [
          { serviceId: mc.id, itemIds: [mc.items[0].id, mc.items[4].id], other: 'Competitor teardown', fee: { amountMinor: 1500000, currency: 'ILS' } },
          { serviceId: adv.id, itemIds: [adv.items[1].id], note: 'Two sessions in December', fee: { amountMinor: 800000, currency: 'ILS' } },
        ],
      },
    };
    const res = await call(OWNER, 'POST', '/contracts/preview', { clientId, templateId: workOrderId, language: 'en', values, signer: {} });
    const html = res.text;
    expect(html).toContain('Diagnostic');
    expect(html).toContain(mc.items[0].labelEn);
    expect(html).toContain(mc.items[4].labelEn);
    expect(html).not.toContain(mc.items[1].labelEn);
    expect(html).toContain('Retainer');
    expect(html).toContain('Competitor teardown');
    expect(html).toContain('Two sessions in December');
    expect(html).not.toContain('☐');
    expect(html).toContain('href="https://field.ledger.invalid/scope_fee_1">₪15,000.00');
    expect(html).toContain('href="https://field.ledger.invalid/scope_fee_2">₪8,000.00');

    scopeContract = await newContract(workOrderId, values, { language: 'en', ownerSign: true });
    await ok(OWNER, 'POST', `/contracts/${scopeContract}/send`, { channel: 'link' });
    const fields = await readFields(await storedPdf(scopeContract, 'sent'));
    const names = fields.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['scope_1_1', 'scope_1_2', 'scope_1_other', 'scope_2_1', 'scope_2_note', 'scope_fee_1', 'scope_fee_2']));
    expect(fields.find((f) => f.name === 'scope_1_1')).toMatchObject({ value: mc.items[0].labelEn, readOnly: true });
    expect(names).not.toContain('scope_1_3');
  });

  it('editing the services list later leaves a sent work order unchanged', async () => {
    const mc = services[0];
    const before = (await first<{ field_values_json: string; sent_pdf_sha256: string }>(env.DB, 'SELECT field_values_json, sent_pdf_sha256 FROM contracts WHERE id = ?', scopeContract))!;
    await ok(OWNER, 'PUT', `/contracts/services/${mc.id}`, {
      nameEn: 'Machine Check Renamed',
      model: 'fixed_fee',
      descriptionEn: 'Changed',
      items: [{ id: mc.items[0].id, labelEn: 'Renamed item' }],
    });
    const after = (await first<{ field_values_json: string; sent_pdf_sha256: string }>(env.DB, 'SELECT field_values_json, sent_pdf_sha256 FROM contracts WHERE id = ?', scopeContract))!;
    expect(after).toEqual(before);
    const detail = (await ok(OWNER, 'GET', `/contracts/${scopeContract}`)).contract;
    expect(detail.values.scope.services[0].nameEn).toBe('Diagnostic');
    expect(detail.values.scope.services[0].items[0].labelEn).toBe(mc.items[0].labelEn);
    // The service row changed. Items left out turned off, none deleted.
    const items = await all<{ active: number }>(env.DB, 'SELECT active FROM contract_service_items WHERE service_id = ?', mc.id);
    expect(items.length).toBe(mc.items.length);
    expect(items.filter((i) => i.active === 1).length).toBe(1);
    // Put the seed back for the tests that follow.
    await ok(OWNER, 'PUT', `/contracts/services/${mc.id}`, { nameEn: mc.nameEn, model: mc.model, modelLabelEn: mc.modelLabelEn, descriptionEn: mc.descriptionEn, items: mc.items.map((i: any) => ({ id: i.id, labelEn: i.labelEn })) });
  });

  it('refuses a service or item of another business or service', async () => {
    const res = await call(OWNER, 'POST', '/contracts/preview', {
      clientId,
      templateId: workOrderId,
      values: { scope: { services: [{ serviceId: services[0].id, itemIds: [services[1].items[0].id] }] } },
    });
    expect(res.status).toBe(400);
  });

  it('work order to pro forma: a draft 300 with one line per ticked service, linked to the contract', async () => {
    const { url } = await ok(OWNER, 'POST', `/contracts/${scopeContract}/remind`, { channel: 'link' });
    await publicCall(url);
    await publicCall(`${url}/code`, 'POST');
    const res = await publicCall(`${url}/sign`, 'POST', { values: { signer_name: 'Dana Cohen', signer_role: 'CEO' }, code: codeFromLastEmail(), signaturePng: SIGNATURE, consent: true });
    expect(res.status).toBe(200);
    const pf = await ok(OWNER, 'POST', `/contracts/${scopeContract}/proforma`, {});
    const doc = await ok(OWNER, 'GET', `/documents/${pf.documentId}`);
    expect(doc.document.type).toBe('300');
    expect(doc.document.status).toBe('draft');
    expect(doc.document.client_id ?? doc.document.clientId).toBe(clientId);
    const lines = doc.lines ?? doc.document.lines;
    expect(lines.map((l: any) => l.unit_price_minor ?? l.unitPriceMinor)).toEqual([1500000, 800000]);
    expect(lines[0].description_en ?? lines[0].descriptionEn).toBe('Diagnostic');
    const again = await ok(OWNER, 'POST', `/contracts/${scopeContract}/proforma`, {});
    expect(again.documentId).toBe(pf.documentId);
    expect((await first<{ linked_document_id: number }>(env.DB, 'SELECT linked_document_id FROM contracts WHERE id = ?', scopeContract))!.linked_document_id).toBe(pf.documentId);
  });
});

describe('the signing link', () => {
  it('a valid link opens the page and logs viewed with IP and user agent', async () => {
    const { id, url } = await sentBilingual();
    const res = await publicCall(url);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Sample Business');
    expect(html).toContain('dana@acme.example');
    expect(html).toContain('id="send-code"');
    const row = (await first<{ status: string; viewed_at: string }>(env.DB, 'SELECT status, viewed_at FROM contracts WHERE id = ?', id))!;
    expect(row.status).toBe('viewed');
    const viewed = (await first<{ ip: string; user_agent: string }>(env.DB, "SELECT ip, user_agent FROM contract_events WHERE contract_id = ? AND kind = 'viewed'", id))!;
    expect(viewed).toEqual({ ip: '84.229.1.2', user_agent: 'Mozilla/5.0 (iPhone) Safari' });
    expect((await publicCall(`${url}/pdf`)).headers.get('content-type')).toBe('application/pdf');
    expect((await publicCall(`${url}?lang=he`)).status).toBe(200);
  });

  it('a forged link opens nothing', async () => {
    const { url } = await sentBilingual();
    const [prefix, token] = url.split('/c/');
    const [body, sig] = token!.split('.');
    const forged = `${prefix}/c/${body}.${sig!.slice(0, -2)}${sig!.endsWith('AA') ? 'BB' : 'AA'}`;
    expect((await publicCall(forged)).status).toBe(410);
    const other = await signSendToken({ SEND_LINK_KEY: 'not-the-key' }, { kind: 'contract', contractId: 1, exp: Math.floor(Date.now() / 1000) + 1000 });
    expect((await publicCall(`${prefix}/c/${other}`)).status).toBe(410);
    // A real signature over an expiry that is not the contract's opens nothing either.
    const row = (await first<{ id: number }>(env.DB, 'SELECT id FROM contracts ORDER BY id DESC LIMIT 1'))!;
    const wrongExp = await signSendToken(env, { kind: 'contract', contractId: row.id, exp: Math.floor(Date.now() / 1000) + 99 });
    expect((await publicCall(`${prefix}/c/${wrongExp}`)).status).toBe(410);
    expect((await publicCall(`${prefix}/c/${wrongExp}/sign`, 'POST', { signaturePng: SIGNATURE, consent: true })).status).toBe(410);
  });

  it('an expired link opens nothing', async () => {
    const { url } = await sentBilingual();
    offsetMs = 15 * 86400000;
    try {
      const res = await publicCall(url);
      expect(res.status).toBe(410);
      expect(await res.text()).toContain('expired');
    } finally {
      offsetMs = 0;
    }
  });

  it('a voided link opens nothing, and void keeps the row', async () => {
    const { id, url } = await sentBilingual();
    await ok(OWNER, 'POST', `/contracts/${id}/void`, { reason: 'Wrong fee' });
    const res = await publicCall(url);
    expect(res.status).toBe(410);
    expect(await res.text()).toContain('withdrew');
    expect((await first<{ status: string }>(env.DB, 'SELECT status FROM contracts WHERE id = ?', id))!.status).toBe('void');
    expect(await sqlError("UPDATE contracts SET status = 'sent' WHERE id = ?", id)).toContain('contract_fixed');
  });
});

describe('the email code', () => {
  it('a wrong code counts down, 5 tries, then a new code is needed', async () => {
    const { url } = await sentBilingual();
    await publicCall(url);
    expect((await publicCall(`${url}/code`, 'POST')).status).toBe(200);
    const good = codeFromLastEmail();
    const wrong = good === '000000' ? '111111' : '000000';
    const signBody = (code: string) => ({ values: { signer_name: 'Dana Cohen' }, code, signaturePng: SIGNATURE, consent: true });
    const first1 = await publicCall(`${url}/sign`, 'POST', signBody(wrong));
    expect(first1.status).toBe(400);
    expect(((await first1.json()) as any).error.message).toContain('4 tries left');
    for (let i = 0; i < 4; i++) await publicCall(`${url}/sign`, 'POST', signBody(wrong));
    const blocked = await publicCall(`${url}/sign`, 'POST', signBody(good));
    expect(((await blocked.json()) as any).error.message).toContain('Too many tries');
    // A new code works.
    await publicCall(`${url}/code`, 'POST');
    const res = await publicCall(`${url}/sign`, 'POST', signBody(codeFromLastEmail()));
    expect(res.status).toBe(200);
  });

  it('a code expires after 10 minutes', async () => {
    const { url } = await sentBilingual();
    await publicCall(`${url}/code`, 'POST');
    const code = codeFromLastEmail();
    offsetMs = 11 * 60 * 1000;
    try {
      const res = await publicCall(`${url}/sign`, 'POST', { values: { signer_name: 'Dana Cohen' }, code, signaturePng: SIGNATURE, consent: true });
      expect(((await res.json()) as any).error.message).toContain('expired');
    } finally {
      offsetMs = 0;
    }
  });

  it('without email the code step is skipped and the evidence says link only', async () => {
    mailOn = false;
    try {
      const { id, url } = await sentBilingual();
      const html = await (await publicCall(url)).text();
      expect(html).not.toContain('id="send-code"');
      const res = await publicCall(`${url}/sign`, 'POST', { values: { signer_name: 'Dana Cohen' }, signaturePng: SIGNATURE, consent: true });
      expect(res.status).toBe(200);
      expect((await first<{ identity_method: string }>(env.DB, 'SELECT identity_method FROM contracts WHERE id = ?', id))!.identity_method).toBe('link_only');
      expect(engine.renders[engine.renders.length - 1]).toContain('Identity confirmed by link only');
    } finally {
      mailOn = true;
    }
  });
});

describe('sign and decline', () => {
  let signedId = 0;
  let signedUrl = '';

  it('signs: final PDF with locked fields, both signatures, evidence page and a certifying signature', async () => {
    slack.length = 0;
    const { id, url } = await sentBilingual({ ownerSign: true });
    signedId = id;
    signedUrl = url;
    await publicCall(url);
    await publicCall(`${url}/code`, 'POST');
    const mailsBefore = mailer.sent.length;
    const res = await publicCall(`${url}/sign`, 'POST', { values: { signer_name: 'Dana Cohen', signer_role: 'CEO' }, code: codeFromLastEmail(), signaturePng: SIGNATURE, consent: true });
    expect(res.status).toBe(200);
    const row = (await first<any>(env.DB, 'SELECT * FROM contracts WHERE id = ?', id))!;
    expect(row.status).toBe('signed');
    expect(row.identity_method).toBe('email_code');
    expect(row.signed_pdf_r2_key).toBe(`business/1/contracts/${row.signed_pdf_sha256}.pdf`);
    expect(row.sent_pdf_r2_key).not.toBe(row.signed_pdf_r2_key);
    expect(await env.FILES.head(row.sent_pdf_r2_key)).not.toBeNull();

    const pdf = await storedPdf(id, 'signed');
    const verified = await verifyPdf(pdf);
    expect(verified.valid).toBe(true);
    expect(verified.signerCommonName).toBe('Sample Business');
    const doc = await PDFDocument.load(pdf);
    expect(doc.catalog.get(PDFName.of('Perms'))).toBeDefined();
    const fields = await readFields(pdf);
    for (const f of fields.filter((x) => x.name !== 'ledger_certification')) expect(f.readOnly).toBe(true);
    expect(fields.find((f) => f.name === 'client_signature')).toMatchObject({ hasAppearance: true });
    expect(fields.find((f) => f.name === 'owner_signature')).toMatchObject({ hasAppearance: true });
    expect(fields.find((f) => f.name === 'signer_name')!.value).toBe('Dana Cohen');
    expect(fields.find((f) => f.name === 'client_date')!.value).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);

    const finalHtml = engine.renders[engine.renders.length - 1]!;
    expect(finalHtml).toContain('Evidence of signing');
    expect(finalHtml).toContain(row.sent_pdf_sha256);
    expect(finalHtml).toContain(row.signed_content_sha256);
    expect(finalHtml).toContain('84.229.1.2');
    expect(finalHtml).toContain('Bilingual services agreement, version 1');
    expect(finalHtml).not.toMatch(/certified signature|qualified signature/i);

    // Emailed to both sides with the signed PDF. Slack told.
    const mails = mailer.sent.slice(mailsBefore);
    expect(mails.map((m) => m.to).sort()).toEqual(['dana@acme.example', OWNER].sort());
    expect(mails[0]!.attachments![0]!.contentType).toBe('application/pdf');
    expect(slack.some((s) => s.includes('signed'))).toBe(true);
    const kinds = (await all<{ kind: string }>(env.DB, 'SELECT kind FROM contract_events WHERE contract_id = ? ORDER BY id', id)).map((e) => e.kind);
    expect(kinds).toEqual(['created', 'owner_signed', 'sent', 'viewed', 'code_sent', 'code_confirmed', 'signed', 'signed_copy_emailed']);
  });

  it('a changed byte breaks the signature', async () => {
    const pdf = await storedPdf(signedId, 'signed');
    const tampered = pdf.slice();
    const at = Math.floor(tampered.length / 3);
    tampered[at] = tampered[at] === 0x41 ? 0x42 : 0x41;
    expect((await verifyPdf(tampered)).valid).toBe(false);
  });

  it('immutability triggers: a signed contract never changes, never deletes, its events are append only', async () => {
    expect(await sqlError("UPDATE contracts SET signed_pdf_sha256 = 'x' WHERE id = ?", signedId)).toContain('contract_fixed');
    expect(await sqlError("UPDATE contracts SET signed_at = '2020-01-01' WHERE id = ?", signedId)).toContain('contract_fixed');
    expect(await sqlError("UPDATE contracts SET status = 'void' WHERE id = ?", signedId)).toContain('contract_fixed');
    expect(await sqlError("UPDATE contracts SET signer_values_json = '{}' WHERE id = ?", signedId)).toContain('contract_fixed');
    expect(await sqlError('DELETE FROM contracts WHERE id = ?', signedId)).toContain('append_only');
    expect(await sqlError("UPDATE contract_events SET kind = 'x' WHERE contract_id = ?", signedId)).toContain('append_only');
    expect(await sqlError('DELETE FROM contract_events WHERE contract_id = ?', signedId)).toContain('append_only');
    expect((await call(OWNER, 'POST', `/contracts/${signedId}/void`, {})).status).toBe(409);
    expect(await sqlError("INSERT INTO contracts (business_id, client_id, template_id, template_version, kind, title, status) VALUES (1, ?, ?, 1, 'contract', 'x', 'signed')", clientId, bilingualId)).toContain('contract_fixed');
  });

  it('a signed link shows the signed page and cannot sign again', async () => {
    const page = await publicCall(signedUrl);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Download signed PDF');
    expect((await publicCall(`${signedUrl}/sign`, 'POST', { signaturePng: SIGNATURE, consent: true })).status).toBe(410);
  });

  it('refuses to sign without consent or a signature', async () => {
    const { url } = await sentBilingual();
    await publicCall(`${url}/code`, 'POST');
    const code = codeFromLastEmail();
    expect((await publicCall(`${url}/sign`, 'POST', { values: { signer_name: 'D' }, code, signaturePng: SIGNATURE, consent: false })).status).toBe(400);
    expect((await publicCall(`${url}/sign`, 'POST', { values: { signer_name: 'D' }, code, signaturePng: 'data:image/png;base64,AAAA', consent: true })).status).toBe(400);
  });

  it('decline records the reason and tells Slack', async () => {
    slack.length = 0;
    const { id, url } = await sentBilingual();
    const res = await publicCall(`${url}/decline`, 'POST', { reason: 'Fee too high' });
    expect(res.status).toBe(200);
    const row = (await first<{ status: string; decline_reason: string }>(env.DB, 'SELECT status, decline_reason FROM contracts WHERE id = ?', id))!;
    expect(row).toEqual({ status: 'declined', decline_reason: 'Fee too high' });
    expect(slack.some((s) => s.includes('declined'))).toBe(true);
    expect((await publicCall(url)).status).toBe(410);
  });
});

describe('roles and businesses', () => {
  it('the assistant creates and sends, but never signs for the business', async () => {
    const id = await newContract(bilingualId, bilingualValues, {}, ASSISTANT);
    expect((await call(ASSISTANT, 'POST', `/contracts/${id}/send`, { channel: 'link' })).status).toBe(200);
    const signing = await newContract(bilingualId, bilingualValues, { ownerSign: true }, ASSISTANT);
    expect((await call(ASSISTANT, 'POST', `/contracts/${signing}/send`, { channel: 'link' })).status).toBe(403);
  });

  it('the accountant views signed contracts only with the contracts switch, and every view is audited', async () => {
    const list = await ok(CPA, 'GET', `/contracts/clients/${clientId}`);
    expect(list.contracts.length).toBeGreaterThan(0);
    expect(list.contracts.every((c: any) => c.status === 'signed')).toBe(true);
    const unsigned = (await first<{ id: number }>(env.DB, "SELECT id FROM contracts WHERE status = 'sent' LIMIT 1"))!;
    expect((await call(CPA, 'GET', `/contracts/${unsigned.id}`)).status).toBe(404);
    const signed = list.contracts[0].id;
    expect((await call(CPA, 'GET', `/contracts/${signed}`)).status).toBe(200);
    const before = (await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'contract.view' AND user_email = ?", CPA))!.n;
    const pdf = await app.request(`/api/contracts/${signed}/pdf?which=signed`, { headers: { 'X-Business-Id': '1' } }, envFor(CPA));
    expect(pdf.status).toBe(200);
    const after = (await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'contract.view' AND user_email = ?", CPA))!.n;
    expect(after).toBe(before + 1);
    expect((await call(CPA, 'POST', `/contracts/${signed}/void`, {})).status).toBe(403);
    expect((await call(CPA_OFF, 'GET', `/contracts/clients/${clientId}`)).status).toBe(403);
  });

  it('another business sees none of it, and gets the neutral sample templates', async () => {
    const b2 = (await ok(OWNER, 'POST', '/businesses', { entityType: 'company', nameEn: 'Second Company Ltd', nameHe: 'חברה שנייה בע"מ', taxId: '515555555', addressEn: 'Haifa' })).businessId;
    const any = (await first<{ id: number }>(env.DB, 'SELECT id FROM contracts WHERE business_id = 1 LIMIT 1'))!;
    expect((await call(OWNER, 'GET', `/contracts/${any.id}`, undefined, b2)).status).toBe(404);
    expect((await call(OWNER, 'GET', `/contracts/clients/${clientId}`, undefined, b2)).status).toBe(404);
    const { templates } = await ok(OWNER, 'GET', '/contracts/templates', undefined, b2);
    expect(templates.map((t: any) => t.name)).toEqual(['Sample agreement', 'Sample work order']);
    expect(templates.every((t: any) => !t.bodyEn.includes('MTN'))).toBe(true);
    expect((await ok(OWNER, 'GET', '/contracts/services', undefined, b2)).services).toEqual([]);
    // A business 1 template cannot be used in business 2.
    const c2 = await ok(OWNER, 'POST', '/clients', { nameEn: 'B2 Client', country: 'IL' }, b2);
    expect((await call(OWNER, 'POST', '/contracts', { clientId: c2.client.id, templateId: bilingualId, values: {} }, b2)).status).toBe(404);
    expect(await sqlError("INSERT INTO contracts (business_id, client_id, template_id, template_version, kind, title) VALUES (?, ?, ?, 1, 'contract', 'x')", b2, clientId, bilingualId)).toContain('business_mismatch');
  });
});

describe('dashboard lines and the 07:00 cron', () => {
  it('lists contracts unsigned after 7 days and links that end within 2 days, then expires them', async () => {
    const { id } = await sentBilingual();
    const in8 = new Date(Date.now() + 8 * 86400000);
    const lines = await contractLines(env.DB, 1, in8);
    expect(lines.unsigned.map((l) => l.id)).toContain(id);
    expect(lines.expiring.map((l) => l.id)).not.toContain(id);
    const in13 = new Date(Date.now() + 13 * 86400000);
    expect((await contractLines(env.DB, 1, in13)).expiring.map((l) => l.id)).toContain(id);

    const messages: string[] = [];
    const notifier = { send: async (t: string) => (messages.push(t), true) };
    const first8 = await contractsCron(env.DB, 1, notifier, in8);
    expect(first8.alerted).toContain(id);
    const again = await contractsCron(env.DB, 1, notifier, in8);
    expect(again.alerted).not.toContain(id);
    const in15 = new Date(Date.now() + 15 * 86400000);
    const swept = await contractsCron(env.DB, 1, notifier, in15);
    expect(swept.expired).toContain(id);
    expect((await first<{ status: string }>(env.DB, 'SELECT status FROM contracts WHERE id = ?', id))!.status).toBe('expired');
  });
});
