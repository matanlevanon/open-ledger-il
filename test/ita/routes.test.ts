import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { all, first, run } from '../../src/core/db';
import { finalizeDocument } from '../../src/core/numbering';
import { createItaModule } from '../../src/modules/ita';
import { D1AllocationDocuments } from '../../src/modules/ita/documents';
import { createApp } from '../../src/index';
import { OWNER_ACTOR, makeSeries } from '../helpers';
import { REFUSED_CLIENT_VAT, insertDocumentRow, setupIta } from './helpers';

type Ctx = Awaited<ReturnType<typeof setupIta>>;

function appFor(ctx: Ctx) {
  return createApp({ modules: [createItaModule(ctx.deps)] });
}

async function call(ctx: Ctx, path: string, init: { method?: string; body?: unknown; as?: string } = {}) {
  const headers: Record<string, string> = { 'CF-Connecting-IP': '203.0.113.5' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  return appFor(ctx).request(
    `https://ledger.test/api/ita${path}`,
    { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) },
    { ...ctx.env, DEV_AUTH_EMAIL: init.as ?? 'owner@example.com' },
  );
}

beforeAll(async () => {
  await run(env.DB, "INSERT OR IGNORE INTO users (email, role) VALUES ('owner@example.com', 'owner')");
  const acc = await run(env.DB, "INSERT INTO users (email, role) VALUES ('cpa@example.com', 'accountant')");
  for (const f of ['income_documents', 'expenses', 'reports']) {
    await run(env.DB, 'INSERT INTO user_features (user_id, feature, enabled) VALUES (?, ?, 1)', acc.lastRowId, f);
  }
});

describe('ITA routes', () => {
  it('connect redirects to the ITA authorize URL and the callback stores the tokens', async () => {
    const ctx = await setupIta({ connect: false });
    const res = await call(ctx, '/connect');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    expect(location.origin + location.pathname).toBe('https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/authorize');
    expect(location.searchParams.get('redirect_uri')).toBe('https://ledger.test/api/ita/callback');
    const state = location.searchParams.get('state')!;

    const code = ctx.mock.issueCode();
    const back = await call(ctx, `/callback?code=${code}&state=${state}`);
    expect(back.status).toBe(302);
    expect(back.headers.get('Location')).toBe('/ita?connected=1');
    const status = (await (await call(ctx, '/status')).json()) as { connection: { connected: boolean; banner: boolean } };
    expect(status.connection).toMatchObject({ connected: true, banner: false });

    // A state works once.
    const replay = await call(ctx, `/callback?code=${ctx.mock.issueCode()}&state=${state}`);
    expect(replay.headers.get('Location')).toBe('/ita?error=state');
    const actions = await all<{ action: string }>(env.DB, "SELECT action FROM audit_log WHERE action LIKE 'ita.connect%' ORDER BY id");
    expect(actions.map((a) => a.action)).toEqual(['ita.connect.start', 'ita.connect.done', 'ita.connect.failed']);
  });

  it('callback: an unknown state or a denied login never stores tokens', async () => {
    const ctx = await setupIta({ connect: false });
    expect((await call(ctx, '/callback?code=x&state=nope')).headers.get('Location')).toBe('/ita?error=state');
    const res = await call(ctx, '/connect');
    const state = new URL(res.headers.get('Location')!).searchParams.get('state')!;
    expect((await call(ctx, `/callback?error=access_denied&state=${state}`)).headers.get('Location')).toBe('/ita?error=denied');
  });

  it('callback: a bad code reports the error code', async () => {
    const ctx = await setupIta({ connect: false });
    const state = new URL((await call(ctx, '/connect')).headers.get('Location')!).searchParams.get('state')!;
    expect((await call(ctx, `/callback?code=forged&state=${state}`)).headers.get('Location')).toBe('/ita?error=ita_reconnect_required');
  });

  it('the dashboard banner shows from day 80', async () => {
    const ctx = await setupIta();
    ctx.clock.advance(80 * 86_400_000);
    const body = (await (await call(ctx, '/status')).json()) as { connection: { banner: boolean; days_until_relogin: number } };
    expect(body.connection).toMatchObject({ banner: true, days_until_relogin: 10 });
  });

  it('accountants never reach the ITA routes', async () => {
    const ctx = await setupIta();
    for (const path of ['/status', '/overview', '/connect']) {
      expect((await call(ctx, path, { as: 'cpa@example.com' })).status).toBe(403);
    }
    const res = await call(ctx, '/allocations/1/decision', { method: 'POST', body: { choice: 'cancel' }, as: 'cpa@example.com' });
    expect(res.status).toBe(403);
    const logged = await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM audit_log WHERE user_email = 'cpa@example.com' AND entity_id LIKE '/api/ita/%'");
    expect(logged!.n).toBeGreaterThanOrEqual(4);
  });

  it('overview lists the queue, refused invoices and documents without numbers', async () => {
    const ctx = await setupIta();
    ctx.mock.refuseCustomers.add(REFUSED_CLIENT_VAT);
    const down = await ctx.addInvoice();
    const refused = await ctx.addInvoice({ customerVatNumber: REFUSED_CLIENT_VAT });
    ctx.mock.forceNext(500);
    await call(ctx, `/allocations/${down.id}/request`, { method: 'POST' });
    const r = await call(ctx, `/allocations/${refused.id}/request`, { method: 'POST' });
    expect(((await r.json()) as { result: { status: string } }).result.status).toBe('refused');

    const noNumber = await insertDocumentRow('allocation_refused', '320', { subtotal: 500001, vat: 90000 });
    const atThreshold = await insertDocumentRow('allocation_refused', '320', { subtotal: 500000, vat: 90000 });
    const receipt = await insertDocumentRow('allocation_refused', '400', { subtotal: 900000, vat: 90000 });

    const body = (await (await call(ctx, '/overview')).json()) as {
      queue: { document_id: number; document: { number: number } }[];
      refused: { document_id: number }[];
      without_numbers: { id: number }[];
      links: { web_app: string };
    };
    expect(body.queue.map((q) => q.document_id)).toContain(down.id);
    expect(body.queue.find((q) => q.document_id === down.id)?.document.number).toBe(down.number);
    expect(body.refused.map((q) => q.document_id)).toContain(refused.id);
    const ids = body.without_numbers.map((d) => d.id);
    expect(ids).toContain(noNumber);
    expect(ids).not.toContain(atThreshold);
    expect(ids).not.toContain(receipt);
    expect(body.links.web_app).toBe('https://secapp.taxes.gov.il/em-hkz-hsb-intr');
  });

  it('decision and manual entry go through the API and write audit rows', async () => {
    const ctx = await setupIta();
    ctx.mock.refuseCustomers.add(REFUSED_CLIENT_VAT);
    const doc = await ctx.addInvoice({ customerVatNumber: REFUSED_CLIENT_VAT });
    await call(ctx, `/allocations/${doc.id}/request`, { method: 'POST' });
    const bad = await call(ctx, `/allocations/${doc.id}/decision`, { method: 'POST', body: { choice: 'shrug' } });
    expect(bad.status).toBe(400);
    const res = await call(ctx, `/allocations/${doc.id}/decision`, { method: 'POST', body: { choice: 'continue' } });
    expect(res.status).toBe(200);
    expect(ctx.docs.docs.get(doc.id)?.status).toBe('final');

    const pending = await ctx.addInvoice();
    ctx.mock.forceNext(503);
    await call(ctx, `/allocations/${pending.id}/request`, { method: 'POST' });
    const manual = await call(ctx, `/allocations/${pending.id}/manual`, {
      method: 'POST',
      body: { confirmation_number: '202703010000000000111222333', source_note: 'Web app' },
    });
    expect(((await manual.json()) as { result: { short_number: string } }).result.short_number).toBe('111222333');
    const detail = (await (await call(ctx, `/allocations/${pending.id}`)).json()) as {
      allocation: { source: string; entered_by: number };
      attempts: unknown[];
    };
    expect(detail.allocation.source).toBe('manual_web_app');
    expect(detail.allocation.entered_by).toBeGreaterThan(0);
    expect(detail.attempts).toHaveLength(1);
    const audits = await all<{ action: string; user_email: string }>(
      env.DB,
      "SELECT action, user_email FROM audit_log WHERE action IN ('ita.allocation.decision', 'ita.allocation.manual') AND entity_id IN (?, ?)",
      String(doc.id),
      String(pending.id),
    );
    expect(audits.map((a) => a.action).sort()).toEqual(['ita.allocation.decision', 'ita.allocation.manual']);
    expect(audits.every((a) => a.user_email === 'owner@example.com')).toBe(true);
  });

  it('reconnect needed: a request answers with the reconnect message and the document is queued', async () => {
    const ctx = await setupIta({ connect: false });
    const doc = await ctx.addInvoice();
    const res = await call(ctx, `/allocations/${doc.id}/request`, { method: 'POST' });
    const body = (await res.json()) as { result: { status: string; outcome: string; message: string } };
    expect(body.result).toMatchObject({ status: 'pending', outcome: 'unauthorized' });
    expect(body.result.message).toContain('Reconnect to ITA');
  });
});

describe('D1 document store', () => {
  it('reads a tax invoice with its client and lines in ILS', async () => {
    const client = await run(
      env.DB,
      "INSERT INTO clients (name_en, name_he, vat_number) VALUES ('Acme', 'אקמי בע\"מ', '514713288')",
    );
    // R11's triggers (migrations/1100_murshe.sql) freeze a document's lines and client the moment
    // it is numbered, in 'awaiting_allocation' the same as 'final' (its hash already covers them).
    // Build it as a draft first, the same order finalize itself uses, then number it with
    // finalizeDocument's status option instead of the raw insertDocumentRow + UPDATE this test
    // used before R11.
    const seriesId = await makeSeries();
    const { lastRowId: id } = await run(
      env.DB,
      `INSERT INTO documents (type, series_id, client_id, status, date, issuance_date, subtotal_minor, vat_rate_bp, vat_amount_minor, total_minor)
       VALUES ('320', ?, ?, 'draft', '2027-02-25', '2027-02-25', 600000, 1800, 108000, 708000)`,
      seriesId,
      client.lastRowId,
    );
    await run(
      env.DB,
      `INSERT INTO document_lines (document_id, position, description_en, quantity_milli, unit_price_minor, discount_minor, line_total_minor)
       VALUES (?, 1, 'Retainer', 1000, 610000, 10000, 600000)`,
      id,
    );
    await finalizeDocument(env.DB, id, { actor: OWNER_ACTOR, status: 'awaiting_allocation' });
    const store = new D1AllocationDocuments(env.DB);
    const doc = (await store.get(id))!;
    expect(doc).toMatchObject({
      type: '320',
      customerVatNumber: '514713288',
      customerName: 'אקמי בע"מ',
      amountBeforeDiscountMinor: 610000,
      discountMinor: 10000,
      paymentAmountMinor: 600000,
      vatAmountMinor: 108000,
      totalMinor: 708000,
      issuanceDate: '2027-02-25',
      proformaDocumentId: null,
    });
    expect(doc.lines).toHaveLength(1);

    await store.setStatus(id, 'allocation_pending');
    expect((await store.get(id))?.status).toBe('allocation_pending');
    const draft = await insertDocumentRow('draft');
    await expect(store.setStatus(draft, 'allocation_refused')).rejects.toMatchObject({ code: 'not_awaiting_allocation' });
    await expect(store.createReverseChargeReplacement()).rejects.toMatchObject({ code: 'reverse_charge_unavailable' });
  });

  /** R19 task 5: the ITA payload is Hebrew-facing, but an English-only client still needs a customerName. */
  it('falls back to the English name for a client with no Hebrew name', async () => {
    const client = await run(env.DB, "INSERT INTO clients (name_en, vat_number) VALUES ('English Only Co', '514713288')");
    const seriesId = await makeSeries();
    const { lastRowId: id } = await run(
      env.DB,
      `INSERT INTO documents (type, series_id, client_id, status, date, issuance_date, subtotal_minor, vat_rate_bp, vat_amount_minor, total_minor)
       VALUES ('320', ?, ?, 'draft', '2027-02-25', '2027-02-25', 600000, 1800, 108000, 708000)`,
      seriesId,
      client.lastRowId,
    );
    await run(
      env.DB,
      `INSERT INTO document_lines (document_id, position, description_en, quantity_milli, unit_price_minor, discount_minor, line_total_minor)
       VALUES (?, 1, 'Retainer', 1000, 610000, 10000, 600000)`,
      id,
    );
    await finalizeDocument(env.DB, id, { actor: OWNER_ACTOR, status: 'awaiting_allocation' });
    const store = new D1AllocationDocuments(env.DB);
    const doc = (await store.get(id))!;
    expect(doc.customerName).toBe('English Only Co');
  });
});
