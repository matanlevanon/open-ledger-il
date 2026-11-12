import { env } from 'cloudflare:workers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { first, run } from '../../src/core/db';
import { createApp } from '../../src/index';
import { modules } from '../../src/modules';
import { makeKey, v1 } from '../modules/api/helpers';

/**
 * R48 task 1: the walls between businesses. Two businesses with two different owners, data in
 * every module for business B. Then, as the owner of A:
 * - every route with X-Business-Id: B answers 403,
 * - every route with an id parameter, called in A with B's ids, answers 404 or 403, never 200,
 * - every Ledger-wide write answers 403 in the firm edition and passes in the single edition,
 * - an MCP token of A with X-Business-Id: B answers 401, an API key of A on B answers 403,
 * - a route added later with an id parameter and no entry in PROBES fails this suite.
 */

const app = createApp();
const ADMIN = 'owner@example.com';
const OWNER_A = 'noauto-iso-owner-a@example.com';
const OWNER_B = 'noauto-iso-owner-b@example.com';
const TODAY = '2026-11-12';

type Edition = 'firm' | 'single';

async function call(email: string, businessId: number | null, method: string, path: string, body?: unknown, edition: Edition = 'firm') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (businessId !== null) headers['X-Business-Id'] = String(businessId);
  const res = await app.request(
    path.startsWith('/mcp') || path.startsWith('/v1') ? path : `/api${path}`,
    { method, headers, body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: email, LEDGER_EDITION: edition, MCP_TOKEN: undefined, MAIL_API_KEY: 'test-not-a-key', MAIL_FROM: 'Test <test@example.com>' },
  );
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function ok(email: string, businessId: number | null, method: string, path: string, body?: unknown, edition: Edition = 'firm') {
  const res = await call(email, businessId, method, path, body, edition);
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** B's ids, filled in beforeAll. */
const B: Record<string, any> = {};
let A = 0;

/** What each id-taking route is probed with. `skip` names why the route needs no probe. */
type Probe = { id: string; sub?: string } | { skip: string };
const pub = { skip: 'public link route, outside Access, authorised by its signed token' };
const demo = { skip: 'demo only, 404 unless DEMO_MODE=1' };
const ledger = { skip: 'Ledger-wide, firm admins only (probed in the Ledger-wide section)' };

const PROBES: Record<string, Probe> = {
  'DELETE /access/firm-team/:id': ledger,
  'DELETE /access/firm-team/:id/admin': ledger,
  'PATCH /access/firm-team/:id': ledger,
  'POST /access/firm-team/:id/admin': ledger,
  'DELETE /access/users/:id': { id: 'userB' },
  'PATCH /access/users/:id': { id: 'userB' },
  'GET /access/downloads/:token': { skip: 'token probed below: a link signed for B is refused in A' },
  'DELETE /settings/api-keys/:id': { id: 'apiKey' },
  'GET /business-documents/:id/file': { id: 'businessDocument' },
  'POST /business-documents/:id/confirm': { id: 'businessDocument' },
  'POST /business-documents/:id/share': { id: 'businessDocument' },
  'POST /business-documents/:id/share/email': { id: 'businessDocument' },
  'POST /business-documents/links/:id/revoke': { id: 'businessDocumentLink' },
  'PATCH /businesses/brands/:id': { id: 'brand' },
  'POST /businesses/:id/moved-out': ledger,
  'DELETE /clients/:id/contacts/:contactId': { id: 'client', sub: 'contact' },
  'GET /clients/:id': { id: 'client' },
  'GET /clients/:id/ledger': { id: 'client' },
  'PATCH /clients/:id': { id: 'client' },
  'PATCH /clients/:id/contacts/:contactId': { id: 'client', sub: 'contact' },
  'POST /clients/:id/activate': { id: 'client' },
  'POST /clients/:id/contacts': { id: 'client' },
  'POST /clients/:id/copy-to-business': { id: 'client' },
  'POST /clients/:id/deactivate': { id: 'client' },
  'GET /sending/public/c/:token': pub,
  'GET /sending/public/c/:token/pdf': pub,
  'GET /sending/public/c/:token/view': pub,
  'GET /sending/public/c/font/:name': pub,
  'POST /sending/public/c/:token/code': pub,
  'POST /sending/public/c/:token/decline': pub,
  'POST /sending/public/c/:token/sign': pub,
  'GET /contracts/:id': { id: 'contract' },
  'GET /contracts/:id/pdf': { id: 'contract' },
  'GET /contracts/clients/:clientId': { id: 'client' },
  'GET /contracts/templates/:id': { id: 'template' },
  'POST /contracts/:id/proforma': { id: 'contract' },
  'POST /contracts/:id/remind': { id: 'contract' },
  'POST /contracts/:id/send': { id: 'contract' },
  'POST /contracts/:id/void': { id: 'contract' },
  'PUT /contracts/:id': { id: 'contract' },
  'PUT /contracts/services/:id': { id: 'contractService' },
  'PUT /contracts/templates/:id': { id: 'template' },
  'POST /dashboard/reminders/:id/share': { id: 'finalDocument' },
  'GET /demo-app/sign-preview/c/:id': demo,
  'GET /demo-app/sign-preview/c/:id/pdf': demo,
  'GET /demo-app/sign-preview/c/:id/view': demo,
  'GET /demo-app/sign-preview/c/font/:name': demo,
  'POST /demo-app/documents/:id/issue-preview': demo,
  'POST /demo-app/documents/:id/receipt-preview': demo,
  'POST /demo-app/documents/:id/send-preview': demo,
  'POST /demo-app/sign-preview/c/:id/code': demo,
  'POST /demo-app/sign-preview/c/:id/decline': demo,
  'POST /demo-app/sign-preview/c/:id/sign': demo,
  'GET /demo/confirm/:token': demo,
  'GET /demo/unsubscribe/:token': demo,
  'DELETE /documents/:id': { id: 'draft' },
  'GET /documents/:id': { id: 'finalDocument' },
  'PATCH /documents/:id': { id: 'draft' },
  'POST /documents/:id/cancel': { id: 'finalDocument' },
  'POST /documents/:id/convert': { id: 'finalDocument' },
  'POST /documents/:id/credit': { id: 'finalDocument' },
  'POST /documents/:id/duplicate': { id: 'finalDocument' },
  'POST /documents/:id/finalize': { id: 'draft' },
  'POST /documents/:id/record-payment': { id: 'finalDocument' },
  'POST /documents/:id/revise': { id: 'finalDocument' },
  'POST /documents/:id/sent': { id: 'finalDocument' },
  'DELETE /expenses/:id': { id: 'expense' },
  'GET /expenses/:id': { id: 'expense' },
  'GET /expenses/files/:id/download': { id: 'expenseFile' },
  'PATCH /expenses/:id': { id: 'expense' },
  'PATCH /expenses/:id/review': { id: 'expense' },
  'PATCH /expenses/categories/:id': ledger,
  'PATCH /expenses/suppliers/:id': { id: 'supplier' },
  'PUT /expenses/business-categories/:key': { id: 'ownCategoryKey' },
  'POST /expenses/:id/read': { id: 'expense' },
  'POST /expenses/:id/status': { id: 'expense' },
  'POST /exports/unified-file/transmissions/:id/check': { id: 'transmission' },
  'DELETE /financy/transactions/:id/match': { id: 'bankTransaction' },
  'GET /financy/transactions/:id/candidates': { id: 'bankTransaction' },
  'POST /financy/transactions/:id/add-expense': { id: 'bankTransaction' },
  'POST /financy/transactions/:id/count': { id: 'bankTransaction' },
  'POST /financy/transactions/:id/ignore': { id: 'bankTransaction' },
  'PUT /financy/transactions/:id/match': { id: 'bankTransaction' },
  'GET /import/external-documents/:id/file': { id: 'externalDocument' },
  'PATCH /import/external-documents/:id': { id: 'externalDocument' },
  'POST /import/external-documents/:id/receipts': { id: 'externalDocument' },
  'POST /import/series/:id/start': { id: 'series' },
  'GET /ita/allocations/:documentId': { id: 'finalDocument' },
  'POST /ita/allocations/:documentId/decision': { id: 'finalDocument' },
  'POST /ita/allocations/:documentId/manual': { id: 'finalDocument' },
  'POST /ita/allocations/:documentId/request': { id: 'finalDocument' },
  'PUT /ops/series/:id/start-number': { id: 'series' },
  'PATCH /payment-methods/:id': { id: 'paymentMethod' },
  'POST /payment-methods/:id/activate': { id: 'paymentMethod' },
  'POST /payment-methods/:id/deactivate': { id: 'paymentMethod' },
  'GET /pdf/documents/:id': { id: 'finalDocument' },
  'GET /pdf/documents/:id/draft.pdf': { id: 'draft' },
  'POST /pdf/documents/:id/download': { id: 'finalDocument' },
  'POST /pdf/documents/:id/pdf': { id: 'finalDocument' },
  'POST /pdf/documents/:id/view': { id: 'finalDocument' },
  'PATCH /recurring/:id': { id: 'recurring' },
  'POST /recurring/runs/:id/approve': { id: 'recurringRun' },
  'POST /recurring/runs/:id/skip': { id: 'recurringRun' },
  'GET /reports/packs/:id/download/:file': { id: 'pack', sub: 'packFile' },
  'GET /reports/r/:id': { skip: 'the id is a report name, not a row. Every report filters by the current business' },
  'GET /reports/r/:id/csv': { skip: 'the id is a report name, not a row' },
  'GET /reports/r/:id/xlsx': { skip: 'the id is a report name, not a row' },
  'GET /sending/clients/:id/consent': { id: 'client' },
  'GET /sending/clients/:id/log': { id: 'client' },
  'GET /sending/clients/:id/reminders': { id: 'client' },
  'GET /sending/documents/:id/log': { id: 'finalDocument' },
  'GET /sending/documents/:id/send-defaults': { id: 'finalDocument' },
  'GET /sending/public/bd/:token': pub,
  'GET /sending/public/consent/:token': pub,
  'GET /sending/public/d/:code': pub,
  'GET /sending/public/d/:code/logo': pub,
  'GET /sending/public/d/:code/pdf': pub,
  'GET /sending/public/share/:token': pub,
  'POST /sending/clients/:id/consent/request': { id: 'client' },
  'POST /sending/clients/:id/consent/revoke': { id: 'client' },
  'POST /sending/documents/:id/send': { id: 'finalDocument' },
  'POST /sending/documents/:id/whatsapp-link': { id: 'finalDocument' },
  'POST /sending/public/consent/:token/accept': pub,
  'GET /business-export/runs/:run': { id: 'exportRun' },
  'POST /business-export/runs/:run/files/:name': { id: 'exportRun', sub: 'exportFile' },
  'PATCH /services/:id': { id: 'service' },
  'POST /services/:id/activate': { id: 'service' },
  'POST /services/:id/archive': { id: 'service' },
};

/** Bodies that pass validation, so the probe reaches the business check. */
const BODIES: Record<string, () => unknown> = {
  'PATCH /access/users/:id': () => ({ role: 'accountant', accessEndsOn: '2099-01-01' }),
  'POST /business-documents/:id/share/email': () => ({ to: 'someone@example.com' }),
  'POST /clients/:id/contacts': () => ({ name: 'Probe' }),
  'POST /clients/:id/copy-to-business': () => ({ businessId: A }),
  'PUT /contracts/:id': () => ({ clientId: B.client, templateId: B.template, title: 'Probe' }),
  'PUT /contracts/services/:id': () => ({ nameEn: 'Probe' }),
  'PUT /contracts/templates/:id': () => ({ name: 'Probe', kind: 'contract', bodyEn: 'x', bodyHe: 'x' }),
  'POST /documents/:id/cancel': () => ({ reason: 'Probe' }),
  'POST /documents/:id/convert': () => ({ type: '400' }),
  'POST /documents/:id/credit': () => ({ mode: 'full' }),
  'POST /documents/:id/record-payment': () => ({ payments: [{ method: 'cash', paidOn: TODAY, amountMinor: 100, currency: 'ILS' }] }),
  'POST /expenses/:id/status': () => ({ status: 'filed' }),
  'PUT /financy/transactions/:id/match': () => ({ expenseId: B.expense }),
  'POST /import/external-documents/:id/receipts': () => ({ documentId: B.finalDocument }),
  'POST /import/series/:id/start': () => ({ startNumber: 5, confirm: true }),
  'PUT /ops/series/:id/start-number': () => ({ startNumber: 5 }),
  'PUT /expenses/business-categories/:key': () => ({ nameEn: 'Taken over' }),
};

/** Every (method, full path) the registry serves. */
function registryRoutes(): { module: string; method: string; path: string }[] {
  const out = new Map<string, { module: string; method: string; path: string }>();
  for (const m of modules) {
    for (const r of m.routes.routes) {
      if (r.method === 'ALL') continue;
      const path = `${m.basePath}${r.path === '/' ? '' : r.path}` || '/';
      out.set(`${r.method} ${path}`, { module: m.name, method: r.method, path });
    }
  }
  return [...out.values()];
}

const OUTSIDE_ACCESS = new Set(['contracts-public', 'demo', 'demo-app', 'inbox']);
const isPublicPath = (path: string) => path.includes('/public/');

function fill(path: string, probe: { id: string; sub?: string }): string {
  let first = true;
  return path.replace(/:([A-Za-z]+)/g, () => {
    const key = first ? probe.id : probe.sub!;
    first = false;
    if (key === 'packFile') return 'pdf';
    if (key === 'exportFile') return 'data.json';
    const value = B[key];
    if (value === undefined) throw new Error(`No B id for ${key}`);
    return String(value);
  });
}

const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
  throw new Error('No network in the isolation suite.');
});
afterAll(() => fetchSpy.mockRestore());

beforeAll(async () => {
  await ok(ADMIN, null, 'GET', '/businesses');
  expect((await first<{ is_ledger_admin: number }>(env.DB, 'SELECT is_ledger_admin FROM users WHERE email = ?', ADMIN))?.is_ledger_admin).toBe(1);
  A = (await ok(ADMIN, 1, 'POST', '/businesses', { entityType: 'company', nameEn: 'Alpha Ltd', nameHe: 'אלפא בע"מ', taxId: '514000009', addressEn: 'Tel Aviv' })).businessId;
  const b = (await ok(ADMIN, 1, 'POST', '/businesses', { entityType: 'company', nameEn: 'Beta Ltd', nameHe: 'בטא בע"מ', taxId: '514000017', addressEn: 'Haifa' })).businessId;
  B.business = b;
  await ok(ADMIN, A, 'POST', '/access/users', { email: OWNER_A, role: 'owner' });
  await ok(ADMIN, b, 'POST', '/access/users', { email: OWNER_B, role: 'owner' });
  await ok(OWNER_B, b, 'POST', '/access/users', { email: 'noauto-iso-b-assistant@example.com', role: 'assistant' });
  B.userB = (await first<{ id: number }>(env.DB, "SELECT id FROM users WHERE email = 'noauto-iso-b-assistant@example.com'"))!.id;

  // Business B's data, made by B's owner where the API makes it, else straight in D1.
  const client = await ok(OWNER_B, b, 'POST', '/clients', { nameEn: 'Shared Name Client', country: 'IL', email: 'client-b@example.com' });
  B.client = client.client.id;
  const contact = await ok(OWNER_B, b, 'POST', `/clients/${B.client}/contacts`, { name: 'Bea Contact', email: 'bea@example.com' });
  B.contact = contact.contact?.id ?? contact.contacts?.at(-1)?.id ?? (await first<{ id: number }>(env.DB, 'SELECT id FROM client_contacts WHERE client_id = ? ORDER BY id DESC', B.client))!.id;
  const draft = await ok(OWNER_B, b, 'POST', '/documents', { type: 'PR', clientId: B.client, date: TODAY, lines: [{ description: 'Draft work', unitPriceMinor: 5000 }] });
  B.draft = draft.document.id;
  const fin = await ok(OWNER_B, b, 'POST', '/documents', { type: 'PR', clientId: B.client, date: TODAY, lines: [{ description: 'Final work', unitPriceMinor: 7000 }] });
  await ok(OWNER_B, b, 'POST', `/documents/${fin.document.id}/finalize`, {});
  B.finalDocument = fin.document.id;
  B.brand = (await ok(OWNER_B, b, 'POST', '/businesses/brands', { nameEn: 'Beta Brand' })).brandId;

  const ins = async (sql: string, ...params: (string | number | null | undefined)[]) => (await run(env.DB, sql, ...params.map((p) => p ?? null))).lastRowId;
  B.paymentMethod = await ins("INSERT INTO payment_methods (display_name, type, business_id) VALUES ('B transfer', 'bank_transfer', ?)", b);
  B.supplier = await ins("INSERT INTO suppliers (name, business_id) VALUES ('B Supplier', ?)", b);
  B.expenseFile = await ins(
    "INSERT INTO expense_files (source, r2_key, filename, content_type, size_bytes, sha256, business_id) VALUES ('upload', 'expenses/iso-b.pdf', 'b.pdf', 'application/pdf', 3, 'iso-b', ?)",
    b,
  );
  await env.FILES.put('expenses/iso-b.pdf', 'b-1');
  B.expense = await ins('INSERT INTO expenses (file_id, business_id) VALUES (?, ?)', B.expenseFile, b);
  B.businessDocument = await ins(
    `INSERT INTO business_documents (business_id, type, r2_key, sha256, file_name, content_type, size_bytes)
     VALUES (?, 'vat_registration', 'business/iso-b-doc.pdf', 'iso', 'doc.pdf', 'application/pdf', 3)`,
    b,
  );
  await env.FILES.put('business/iso-b-doc.pdf', 'doc');
  B.businessDocumentLink = await ins("INSERT INTO business_document_links (business_id, document_id, expires_at) VALUES (?, ?, '2099-01-01T00:00:00Z')", b, B.businessDocument);
  B.template = await ins("INSERT INTO contract_templates (business_id, name, kind) VALUES (?, 'B template', 'contract')", b);
  B.contractService = await ins("INSERT INTO contract_services (business_id, name_en) VALUES (?, 'B service')", b);
  B.contract = await ins(
    "INSERT INTO contracts (business_id, client_id, template_id, template_version, kind, title) VALUES (?, ?, ?, 1, 'contract', 'B contract')",
    b,
    B.client,
    B.template,
  );
  B.apiKey = (await makeKey('read', b, 'B key')).apiKey.id;
  B.recurring = await ins(
    "INSERT INTO recurring_schedules (template_document_id, frequency, anchor_day, next_run_date, business_id) VALUES (?, 'monthly', 1, '2026-12-01', ?)",
    B.finalDocument,
    b,
  );
  B.recurringRun = await ins("INSERT INTO recurring_runs (schedule_id, run_date, status) VALUES (?, '2026-11-01', 'pending_approval')", B.recurring);
  B.bankTransaction = await ins(
    "INSERT INTO bank_transactions (business_id, financy_id, kind, booked_on, amount_minor, currency) VALUES (?, 'iso-tx', 'BANK', '2026-11-01', -1000, 'ILS')",
    b,
  );
  B.externalDocument = await ins(
    `INSERT INTO external_documents (source, original_number, doc_type, issue_date, client_name_text, currency, amount_before_vat_minor, total_minor, paid_status, r2_key, sha256, business_id)
     VALUES ('other', 'X-1', '320', '2025-01-01', 'Old client', 'ILS', 100, 100, 'paid', 'business/iso-ext.pdf', 'iso-ext', ?)`,
    b,
  );
  B.transmission = await ins(
    "INSERT INTO unified_file_transmissions (business_id, environment, period_from, period_to, case_number) VALUES (?, 'sandbox', '2025-01-01', '2025-12-31', 'iso-case')",
    b,
  );
  B.pack = await ins(
    "INSERT INTO accountant_packs (business_id, period, pdf_key, xlsx_key, zip_key) VALUES (?, '2026-10', 'packs/b.pdf', 'packs/b.xlsx', 'packs/b.zip')",
    b,
  );
  const series = await first<{ id: string }>(env.DB, "SELECT id FROM series WHERE business_id = ? AND doc_type = '305'", b);
  B.series = series!.id;
  B.exportRun = (await ok(OWNER_B, b, 'POST', '/business-export/runs')).run.id;
  B.ownCategoryKey = encodeURIComponent((await ok(OWNER_B, b, 'POST', '/expenses/business-categories', { nameEn: 'B only' })).categories.find((x: { own: number }) => x.own === 1).key);
  B.service = await ins("INSERT INTO items (name_en, business_id) VALUES ('B item', ?)", b).catch(() => 0);
});

describe('R48 isolation: X-Business-Id of another business', () => {
  it('answers 403 on every route reached through Access', async () => {
    const failures: string[] = [];
    for (const r of registryRoutes()) {
      if (OUTSIDE_ACCESS.has(r.module) || isPublicPath(r.path)) continue;
      const path = r.path.replace(/:[A-Za-z]+/g, '1');
      const res = await call(OWNER_A, B.business!, r.method, path, {});
      if (res.status !== 403) failures.push(`${r.method} ${r.path} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('R48 isolation: B ids called in A', () => {
  it('every id-taking route is in the probe table', () => {
    const missing = registryRoutes()
      .filter((r) => r.path.includes(':'))
      .map((r) => `${r.method} ${r.path}`)
      .filter((key) => !(key in PROBES));
    expect(missing).toEqual([]);
  });

  it('answers 404 or 403, never 200', async () => {
    const failures: string[] = [];
    for (const [key, probe] of Object.entries(PROBES)) {
      if ('skip' in probe) continue;
      const [method, path] = key.split(' ') as [string, string];
      const res = await call(OWNER_A, A, method, fill(path, probe), BODIES[key]?.() ?? {});
      if (res.status !== 403 && res.status !== 404) failures.push(`${key} -> ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
    }
    expect(failures).toEqual([]);
  });

  it('a signed download link made for B does not open in A', async () => {
    const { signDownloadUrl } = await import('../../src/modules/access/downloads');
    const { path } = await signDownloadUrl(env, 'expenses/iso-b.pdf', 'expenses', 600, { businessId: B.business });
    const res = await call(OWNER_A, A, 'GET', path);
    expect(res.status).toBe(403);
  });
});

/** Ledger-wide writes and reads of shared, non-law tables. */
const LEDGER_WIDE: [string, string, unknown][] = [
  ['POST', '/businesses', { entityType: 'company', nameEn: 'Gamma Ltd', nameHe: 'גמא בע"מ', taxId: '514000025', addressEn: 'Eilat' }],
  ['POST', '/ops/vat-rates', { rateBp: 1800, effectiveFrom: '2099-01-01' }],
  ['PUT', '/ops/ceilings', { year: 2099, amountMinor: 12000000 }],
  ['POST', '/ops/checks/run', {}],
  ['GET', '/ops/backups', undefined],
  ['POST', '/fx/rates/fetch', { currency: 'USD' }],
  ['POST', '/fx/rates/backfill', { currency: 'USD', from: '2026-01-01', to: '2026-01-02' }],
  ['GET', '/updates', undefined],
  ['POST', '/expenses/categories', { key: 'iso_cat', nameEn: 'Iso category' }],
  ['POST', '/settings/mcp/enabled', { enabled: true }],
];

describe('R48 isolation: Ledger-wide actions', () => {
  it('answer 403 to a business owner in the firm edition', async () => {
    const failures: string[] = [];
    for (const [method, path, body] of LEDGER_WIDE) {
      const res = await call(OWNER_A, A, method, path, body, 'firm');
      if (res.status !== 403) failures.push(`${method} ${path} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('pass the admin check for the same owner in the single edition', async () => {
    const failures: string[] = [];
    for (const [method, path, body] of LEDGER_WIDE) {
      const res = await call(OWNER_A, A, method, path, body, 'single');
      if (res.status === 403 || res.status === 401) failures.push(`${method} ${path} -> ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
    }
    expect(failures).toEqual([]);
  });

  it('the firm team screen answers 403 to a business owner and serves an admin', async () => {
    expect((await call(OWNER_A, A, 'GET', '/access/firm-team')).status).toBe(403);
    expect((await call(ADMIN, A, 'GET', '/access/firm-team')).status).toBe(200);
  });
});

describe('R48 isolation: tokens and keys', () => {
  it('an MCP token of A with X-Business-Id: B answers 401, with A it works', async () => {
    const made = await ok(OWNER_A, A, 'POST', '/settings/mcp/token', {});
    const mcp = (business: number) =>
      app.request(
        '/mcp',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${made.token}`, 'X-Business-Id': String(business) },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        },
        { ...env, LEDGER_EDITION: 'firm', MCP_TOKEN: undefined },
      );
    const refused = await mcp(B.business!);
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'A valid bearer token is required.' } });
    expect((await mcp(A)).status).toBe(200);
  });

  it('the public API key of A on B answers 403', async () => {
    const { key } = await makeKey('read', A, 'A key');
    const res = await v1('/business', { key, business: String(B.business) });
    expect(res.status).toBe(403);
  });
});
