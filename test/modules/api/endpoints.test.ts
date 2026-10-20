import { beforeAll, describe, expect, it } from 'vitest';
import { first, run } from '../../../src/core/db';
import { createApiRoutes } from '../../../src/modules/api';
import { RATE_LIMIT } from '../../../src/modules/api/keys';
import { buildOpenApi } from '../../../src/modules/api/openapi';
import { findTool } from '../../../src/modules/mcp/tools';
import { businessesApp, okIn, OWNER } from '../businesses/helpers';
import { FAKE_PDF, env, makeKey, ownerActor, v1 } from './helpers';

/** R41 tasks 3 to 5: the /v1 read and write endpoints, paging, scoping, idempotency, the rate limit and the spec. */

let readKey = '';
let writeKey = '';
let b2 = 0;
let otherClient = 0;
let otherDoc = 0;
const clients: number[] = [];
let draftId = 0;
let finalId = 0;
const mcpEnv = { db: env.DB, actor: { userId: null, email: 'test', role: 'owner' as const, ip: null, userAgent: null }, businessId: 1 };

beforeAll(async () => {
  readKey = (await makeKey('read')).key;
  writeKey = (await makeKey('write')).key;
  const bapp = businessesApp();
  await okIn(bapp, OWNER, null, 'GET', '/businesses');
  b2 = (await okIn(bapp, OWNER, 1, 'POST', '/businesses', { entityType: 'company', nameEn: 'Other Ltd', nameHe: 'אחר בע"מ', taxId: '516666666', addressEn: 'Eilat' })).businessId;
  otherClient = (await okIn(bapp, OWNER, b2, 'POST', '/clients', { nameEn: 'Hidden Client', country: 'IL' })).client.id;
  otherDoc = (await okIn(bapp, OWNER, b2, 'POST', '/documents', { type: 'PR', clientId: otherClient, lines: [{ description: 'x', unitPriceMinor: 100 }] })).document.id;

  for (const name of ['Api Alpha', 'Api Beta', 'Api Gamma']) {
    const r = await v1('/clients', { key: writeKey, method: 'POST', body: { nameEn: name, email: `${name.split(' ')[1]!.toLowerCase()}@example.com` } });
    clients.push(r.body.id);
  }
  draftId = (await v1('/documents', { key: writeKey, method: 'POST', body: { type: 'PR', clientId: clients[0], lines: [{ description: 'Draft work', unitPriceMinor: 5000 }] } })).body.id;
  const toFinal = (await v1('/documents', { key: writeKey, method: 'POST', body: { type: 'PR', clientId: clients[1], lines: [{ description: 'Final work', unitPriceMinor: 20000 }] } })).body.id;
  await findTool('finalize_document')!.handler(mcpEnv, { documentId: toFinal, confirm: true });
  finalId = toFinal;
  await findTool('record_payment')!.handler(mcpEnv, { documentId: finalId, confirm: true, payments: [{ method: 'bank_transfer', amountMinor: 5000, paidOn: '2026-10-05' }] });
  await run(env.DB, "INSERT INTO suppliers (name, tax_id, business_id) VALUES ('Api Supplier', '512345678', 1)");
  await run(env.DB, "INSERT INTO expenses (status, document_date, currency, amount_minor, vat_amount_minor, business_id, read_status) VALUES ('new', '2026-10-03', 'ILS', 11800, 1800, 1, 'manual')");
});

describe('R41: read endpoints', () => {
  it('GET /business', async () => {
    const r = await v1('/business', { key: readKey });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: 1, currency: 'ILS' });
    expect(['patur', 'murshe']).toContain(r.body.legalMode);
  });

  it('GET /clients pages with a cursor, filters by q, and never shows another business', async () => {
    const first2 = await v1('/clients?limit=2', { key: readKey });
    expect(first2.body.data).toHaveLength(2);
    expect(first2.body.nextCursor).toEqual(expect.any(String));
    const rest = await v1(`/clients?limit=200&cursor=${first2.body.nextCursor}`, { key: readKey });
    const ids = [...first2.body.data, ...rest.body.data].map((c: any) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of clients) expect(ids).toContain(id);
    expect(ids).not.toContain(otherClient);
    expect(rest.body.nextCursor).toBeNull();

    const beta = await v1('/clients?q=Api%20Beta', { key: readKey });
    expect(beta.body.data.map((c: any) => c.nameEn)).toEqual(['Api Beta']);
    expect(beta.body.data[0]).toMatchObject({ email: 'beta@example.com', currency: 'ILS', active: true, openBalance: { ILS: 15000 } });
    expect((await v1(`/clients/${otherClient}`, { key: readKey })).status).toBe(404);
  });

  it('updatedSince returns only rows changed after it', async () => {
    const later = await v1(`/clients?updatedSince=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`, { key: readKey });
    expect(later.body.data).toEqual([]);
    const since = await v1('/clients?updatedSince=2000-01-01T00:00:00Z&limit=200', { key: readKey });
    expect(since.body.data.length).toBeGreaterThanOrEqual(3);
    expect((await v1('/clients?updatedSince=yesterday', { key: readKey })).status).toBe(422);
  });

  it('GET /documents filters by type, status and client, with totals, and never another business', async () => {
    const all = await v1('/documents?limit=200', { key: readKey });
    const ids = all.body.data.map((d: any) => d.id);
    expect(ids).toContain(draftId);
    expect(ids).not.toContain(otherDoc);
    const finals = await v1(`/documents?status=final&type=PR&clientId=${clients[1]}`, { key: readKey });
    expect(finals.body.data.map((d: any) => d.id)).toEqual([finalId]);
    expect(finals.body.data[0]).toMatchObject({ type: 'PR', status: 'final', currency: 'ILS', totals: { total: 20000, paid: 5000, open: 15000 }, clientName: 'Api Beta' });
    expect(finals.body.data[0].number).toMatch(/^PR-\d{4}$/);
  });

  it('GET /documents/{id} carries lines and payments', async () => {
    const r = await v1(`/documents/${finalId}`, { key: readKey });
    expect(r.body.lines).toEqual([expect.objectContaining({ description: 'Final work', quantity: 1, unitPrice: 20000, lineTotal: 20000 })]);
    expect((await v1(`/documents/${otherDoc}`, { key: readKey })).status).toBe(404);
  });

  it('GET /documents/{id}/pdf: the client copy of a final document only', async () => {
    const pdf = await v1(`/documents/${finalId}/pdf`, { key: readKey });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(pdf.body as ArrayBuffer)).toEqual(FAKE_PDF);
    const draft = await v1(`/documents/${draftId}/pdf`, { key: readKey });
    expect(draft.status).toBe(409);
    expect(draft.body.error.code).toBe('not_final');
    expect((await v1(`/documents/${otherDoc}/pdf`, { key: readKey })).status).toBe(404);
  });

  it('GET /payments, /expenses and /suppliers', async () => {
    const payments = await v1('/payments?from=2026-10-01&to=2026-10-31', { key: readKey });
    // Record payment on a payment request issues a receipt, which holds the payment.
    expect(payments.body.data).toEqual([expect.objectContaining({ method: 'bank_transfer', amount: 5000, currency: 'ILS', date: '2026-10-05' })]);
    const receipt = await v1(`/documents/${payments.body.data[0].documentId}`, { key: readKey });
    expect(receipt.body).toMatchObject({ type: '400', status: 'final', relatedDocumentIds: expect.arrayContaining([finalId]) });
    const expenses = await v1('/expenses?from=2026-10-01&status=new', { key: readKey });
    expect(expenses.body.data.some((e: any) => e.total === 11800 && e.vat === 1800 && e.readStatus === 'manual')).toBe(true);
    const suppliers = await v1('/suppliers', { key: readKey });
    expect(suppliers.body.data.some((s: any) => s.name === 'Api Supplier' && s.taxId === '512345678')).toBe(true);
  });
});

describe('R41: write endpoints', () => {
  it('a read key gets 403 scope_required', async () => {
    const r = await v1('/clients', { key: readKey, method: 'POST', body: { nameEn: 'Nope' } });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('scope_required');
    expect((await v1('/documents', { key: readKey, method: 'POST', body: { type: 'PR' } })).status).toBe(403);
  });

  it('POST /clients creates the client and audits the key name', async () => {
    const r = await v1('/clients', { key: writeKey, method: 'POST', body: { nameHe: 'לקוח מה-API', companyId: '515555555' } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ nameHe: 'לקוח מה-API', companyId: '515555555' });
    const audit = await first<{ user_email: string; details: string }>(env.DB, "SELECT user_email, details FROM audit_log WHERE action = 'api.client.create' AND entity_id = ?", String(r.body.id));
    expect(audit?.user_email).toMatch(/^api:Key /);
    expect(audit?.details).not.toContain('ol_live_');
    expect((await v1('/clients', { key: writeKey, method: 'POST', body: { email: 'not-an-email' } })).status).toBe(422);
  });

  it('POST /documents makes a draft only, with the page where a person issues it', async () => {
    const r = await v1('/documents', { key: writeKey, method: 'POST', body: { type: 'PR', clientId: clients[2], lines: [{ description: 'Retainer', unitPriceMinor: 100000 }] } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'draft', number: null, totals: { total: 100000 } });
    expect(r.body.editUrl).toMatch(new RegExp(`/income/documents/${r.body.id}/edit$`));
    const row = await first<{ status: string; number: number | null }>(env.DB, 'SELECT status, number FROM documents WHERE id = ?', r.body.id);
    expect(row).toEqual({ status: 'draft', number: null });
    expect(await first(env.DB, "SELECT 1 FROM audit_log WHERE action = 'api.document.draft' AND entity_id = ?", String(r.body.id))).not.toBeNull();
  });

  it('refuses the types that are not drafts a key may make', async () => {
    for (const type of ['305', '320', '330', '405']) {
      const r = await v1('/documents', { key: writeKey, method: 'POST', body: { type } });
      expect(r.status).toBe(422);
    }
  });

  it('the same Idempotency-Key and body returns the first answer, never a second draft', async () => {
    const body = { type: 'QT', clientId: clients[0], lines: [{ description: 'Quote once', unitPriceMinor: 700 }] };
    const headers = { 'Idempotency-Key': `idem-${crypto.randomUUID()}` };
    const one = await v1('/documents', { key: writeKey, method: 'POST', body, headers });
    const two = await v1('/documents', { key: writeKey, method: 'POST', body, headers });
    expect(two.status).toBe(201);
    expect(two.body.id).toBe(one.body.id);
    expect(two.headers.get('Idempotent-Replayed')).toBe('true');
    const count = await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM document_lines WHERE description_en = 'Quote once'");
    expect(count?.n).toBe(1);
    const other = await v1('/documents', { key: writeKey, method: 'POST', body: { ...body, notes: 'changed' }, headers });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('idempotency_conflict');
  });
});

describe('R41: limits and the spec', () => {
  it('answers 429 with Retry-After past 120 requests a minute', async () => {
    const { key, apiKey } = await makeKey();
    const minute = new Date().toISOString().slice(0, 16);
    await run(env.DB, 'INSERT INTO api_rate (key_id, minute, count) VALUES (?, ?, ?)', apiKey.id, minute, RATE_LIMIT);
    const r = await v1('/business', { key });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('rate_limited');
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('errors never carry a stack or the key', async () => {
    const r = await v1('/documents?from=not-a-date', { key: readKey });
    expect(r.status).toBe(422);
    expect(Object.keys(r.body)).toEqual(['error']);
    expect(JSON.stringify(r.body)).not.toContain(readKey);
    expect((await v1('/nothing-here', { key: readKey })).status).toBe(404);
  });

  it('GET /openapi.json needs no key and lists every route of the router', async () => {
    const r = await v1('/openapi.json', { business: null });
    expect(r.status).toBe(200);
    expect(r.body.openapi).toBe('3.1.0');
    const spec = buildOpenApi('https://ledger.example') as { paths: Record<string, Record<string, unknown>> };
    const routes = createApiRoutes().routes.filter((rt) => rt.method !== 'ALL');
    expect(routes.length).toBeGreaterThan(10);
    for (const rt of routes) {
      const path = rt.path.replace(/:(\w+)/g, '{$1}');
      expect(spec.paths[path], `${rt.method} ${rt.path}`).toBeDefined();
      expect(spec.paths[path]![rt.method.toLowerCase()], `${rt.method} ${rt.path}`).toBeDefined();
    }
  });

  it('the key belongs to its business: business 2 data needs a business 2 key', async () => {
    const { key } = await makeKey('read', b2);
    const docs = await v1('/documents?limit=200', { key, business: String(b2) });
    expect(docs.body.data.map((d: any) => d.id)).toEqual([otherDoc]);
    expect(ownerActor(b2).businessId).toBe(b2);
  });
});
