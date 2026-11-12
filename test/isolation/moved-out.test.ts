import { env } from 'cloudflare:workers';
import { zipSync } from 'fflate';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { all, first, run } from '../../src/core/db';
import { forEachBusiness } from '../../src/core/business';
import { createApp } from '../../src/index';
import { buildUnifiedFile } from '../../src/modules/exports/unified-file/build';
import { syncAllDaily } from '../../src/modules/financy/sync';

/**
 * R48 task 5: a client moves to their own Ledger. The firm's copy becomes read-only, the export
 * feeds the new Ledger's start numbers, data and history. The new Ledger here is another business
 * of the same test D1, the only database a test has.
 */
const app = createApp();
const OWNER = 'owner@example.com';
const TODAY = '2026-11-12';

async function call(businessId: number, method: string, path: string, body?: unknown, edition: 'single' | 'firm' = 'firm') {
  const res = await app.request(
    path.startsWith('/v1') || path.startsWith('/mcp') ? path : `/api${path}`,
    { method, headers: { 'content-type': 'application/json', 'X-Business-Id': String(businessId) }, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: OWNER, LEDGER_EDITION: edition, MAIL_API_KEY: 'test-not-a-key' },
  );
  const buf = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder().decode(buf);
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, buf };
}

async function ok(businessId: number, method: string, path: string, body?: unknown) {
  const r = await call(businessId, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

let OLD = 0;
let NEW = 0;
let clientId = 0;
let draftId = 0;
let finalId = 0;
let manifest: any;
let dataJson: any;

async function exportAll(businessId: number) {
  const run = (await ok(businessId, 'POST', '/business-export/runs')).run;
  let last: any;
  for (const f of run.files) last = await ok(businessId, 'POST', `/business-export/runs/${run.id}/files/${encodeURIComponent(f.name)}`);
  const files: Record<string, Uint8Array> = {};
  for (const f of last.run.files) files[f.name] = (await call(businessId, 'GET', f.links[0])).buf;
  return files;
}

beforeAll(async () => {
  await call(1, 'GET', '/businesses');
  OLD = (await ok(1, 'POST', '/businesses', { entityType: 'company', nameEn: 'Leaving Ltd', nameHe: 'עוזבת בע"מ', taxId: '514000124', addressEn: 'X' })).businessId;
  const client = await ok(OLD, 'POST', '/clients', { nameEn: 'Loyal Client', country: 'IL', email: 'loyal@example.com', companyId: '514000132' });
  clientId = client.client.id;
  for (let i = 0; i < 3; i++) {
    const d = await ok(OLD, 'POST', '/documents', { type: 'PR', clientId, date: TODAY, lines: [{ description: `Work ${i}`, unitPriceMinor: 10000 + i }] });
    await ok(OLD, 'POST', `/documents/${d.document.id}/finalize`, {});
    finalId = d.document.id;
  }
  // Receipts go in the unified file. Payment requests do not.
  for (const amount of [30000, 12345]) {
    const r = await ok(OLD, 'POST', '/documents', { type: '400', clientId, date: TODAY, payments: [{ method: 'bank_transfer', paidOn: TODAY, amountMinor: amount }] });
    await ok(OLD, 'POST', `/documents/${r.document.id}/finalize`, {});
  }
  draftId = (await ok(OLD, 'POST', '/documents', { type: 'PR', clientId, date: TODAY, lines: [{ description: 'Draft', unitPriceMinor: 500 }] })).document.id;
});

describe('R48 mark as moved out', () => {
  it('needs a complete export and the business name typed', async () => {
    const early = await call(OLD, 'POST', `/businesses/${OLD}/moved-out`, { confirmName: 'Leaving Ltd' });
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe('export_required');
    const files = await exportAll(OLD);
    manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
    dataJson = JSON.parse(new TextDecoder().decode(files['data.json']));
    expect((await call(OLD, 'POST', `/businesses/${OLD}/moved-out`, { confirmName: 'Leaving' })).json.error.code).toBe('confirm_name');
    const done = await call(OLD, 'POST', `/businesses/${OLD}/moved-out`, { confirmName: 'Leaving Ltd', note: 'Moved to their own Ledger' });
    expect(done.status).toBe(200);
    expect(done.json.businesses.find((b: { id: number }) => b.id === OLD).status).toBe('moved_out');
  });

  it('is refused to a business owner who is not a Ledger admin, in the firm edition', async () => {
    await run(env.DB, "INSERT INTO users (email, role) VALUES ('noauto-moved-owner@example.com', 'owner')");
    const u = await first<{ id: number }>(env.DB, "SELECT id FROM users WHERE email = 'noauto-moved-owner@example.com'");
    await run(env.DB, "INSERT INTO user_businesses (user_id, business_id, role) VALUES (?, 1, 'owner')", u!.id);
    const res = await app.request(
      `/api/businesses/1/moved-out`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'X-Business-Id': '1' }, body: JSON.stringify({ confirmName: 'x' }) },
      { ...env, DEV_AUTH_EMAIL: 'noauto-moved-owner@example.com', LEDGER_EDITION: 'firm' },
    );
    expect(res.status).toBe(403);
  });
});

describe('R48 a moved-out business is read-only', () => {
  it('refuses drafts, edits, finalize, send, payment, the ITA, Financy sync and a new client', async () => {
    const blocked: [string, string, unknown][] = [
      ['POST', '/documents', { type: 'PR', clientId, date: TODAY, lines: [{ description: 'x', unitPriceMinor: 1 }] }],
      ['PATCH', `/documents/${draftId}`, { lines: [{ description: 'y', unitPriceMinor: 2 }] }],
      ['POST', `/documents/${draftId}/finalize`, {}],
      ['POST', `/sending/documents/${finalId}/send`, { to: 'loyal@example.com' }],
      ['POST', `/sending/documents/${finalId}/whatsapp-link`, {}],
      ['POST', `/documents/${finalId}/record-payment`, { payments: [{ method: 'cash', paidOn: TODAY, amountMinor: 100, currency: 'ILS' }] }],
      ['POST', `/ita/allocations/${finalId}/request`, {}],
      ['POST', '/financy/sync', {}],
      ['POST', '/clients', { nameEn: 'New', country: 'IL' }],
    ];
    for (const [method, path, body] of blocked) {
      const res = await call(OLD, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(409);
      expect(res.json.error.code).toBe('business_moved_out');
    }
  });

  it('the trigger refuses a finalization that skips the services', async () => {
    const series = await first<{ id: string; next_number: number }>(env.DB, "SELECT id, next_number FROM series WHERE business_id = ? AND doc_type = 'PR'", OLD);
    let error = '';
    try {
      await env.DB.prepare(
        "INSERT INTO finalizations (document_id, series_id, number, doc_version, prev_hash, hash, business_id) VALUES (?, ?, ?, 1, 'x', 'y-moved', ?)",
      )
        .bind(draftId, series!.id, series!.next_number, OLD)
        .run();
    } catch (e) {
      error = String(e);
    }
    expect(error).toContain('business_moved_out');
  });

  it('never moves back', async () => {
    let error = '';
    try {
      await env.DB.prepare("UPDATE businesses SET status = 'active' WHERE id = ?").bind(OLD).run();
    } catch (e) {
      error = String(e);
    }
    expect(error).toContain('business_moved_out');
  });

  it('cron jobs skip it: recurring, reminders and Financy', async () => {
    const seen: number[] = [];
    await forEachBusiness(env.DB, 'test', async (id) => {
      seen.push(id);
    });
    expect(seen).not.toContain(OLD);
    await run(
      env.DB,
      "INSERT INTO financy_connection (business_id, client_id, user_id, status) VALUES (?, 'c', 'u', 'connected')",
      OLD,
    ).catch(() => undefined);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));
    const result = await syncAllDaily(env, { fetch: fetchSpy as unknown as typeof fetch } as never);
    expect(result.synced + result.failed).toBe(0);
    fetchSpy.mockRestore();
  });

  it('reading and downloading still work', async () => {
    expect((await call(OLD, 'GET', '/documents')).status).toBe(200);
    expect((await call(OLD, 'GET', `/documents/${finalId}`)).status).toBe(200);
    expect((await call(OLD, 'GET', '/clients')).status).toBe(200);
    expect((await call(OLD, 'POST', '/business-export/runs')).status).toBe(201);
  });
});

describe('R48 the new Ledger continues', () => {
  beforeAll(async () => {
    NEW = (await ok(1, 'POST', '/businesses', { entityType: 'company', nameEn: 'Leaving Ltd New', nameHe: 'חדשה', taxId: '514000140', addressEn: 'X' })).businessId;
  });

  it('Continue from another Ledger sets the start numbers, and the first finalize has no gap', async () => {
    const res = await ok(NEW, 'POST', '/ops/series/continue', manifest);
    const pr = res.applied.find((a: { docType: string }) => a.docType === 'PR');
    const oldNext = manifest.startNumbers.find((s: { docType: string }) => s.docType === 'PR').nextNumber;
    expect(pr.startNumber).toBe(oldNext);
    const client = await ok(NEW, 'POST', '/clients', { nameEn: 'First', country: 'IL' });
    const d = await ok(NEW, 'POST', '/documents', { type: 'PR', clientId: client.client.id, date: TODAY, lines: [{ description: 'First here', unitPriceMinor: 100 }] });
    const fin = await ok(NEW, 'POST', `/documents/${d.document.id}/finalize`, {});
    expect(fin.document.number).toBe(oldNext);
    // A series in use is skipped the second time.
    expect((await ok(NEW, 'POST', '/ops/series/continue', manifest)).skipped.some((s: { docType: string }) => s.docType === 'PR')).toBe(true);
  });

  it('data.json brings clients in as new rows, and skips a duplicate by tax id or email', async () => {
    const first1 = await ok(NEW, 'POST', '/import/ledger-data', dataJson);
    expect(first1.created.clients).toBe(1);
    const imported = await first<{ id: number; email: string }>(env.DB, "SELECT id, email FROM clients WHERE business_id = ? AND email = 'loyal@example.com'", NEW);
    expect(imported!.id).not.toBe(clientId);
    const again = await ok(NEW, 'POST', '/import/ledger-data', dataJson);
    expect(again.created.clients).toBe(0);
    expect(again.skipped.some((s: { kind: string }) => s.kind === 'client')).toBe(true);
  });

  it("the unified file round trip: the Ledger's own file imports, counts and totals match per type", async () => {
    const built = await buildUnifiedFile(env, `${TODAY.slice(0, 4)}-01-01`, `${TODAY.slice(0, 4)}-12-31`, { businessId: OLD });
    const zip = zipSync({ 'OPENFRMT/INI.TXT': built.iniBytes, 'OPENFRMT/BKMVDATA.TXT': built.bkmvBytes });
    const form = new FormData();
    form.set('file', new File([zip], 'openfrmt.zip', { type: 'application/zip' }));
    const res = await app.request('/api/import/sumit/unified/commit', { method: 'POST', headers: { 'X-Business-Id': String(NEW) }, body: form }, { ...env, DEV_AUTH_EMAIL: OWNER, LEDGER_EDITION: 'firm' });
    expect(res.status).toBeLessThan(300);
    const rows = await all<{ doc_type: string; n: number; total: number }>(
      env.DB,
      "SELECT doc_type, COUNT(*) AS n, SUM(amount_minor) AS total FROM history WHERE business_id = ? AND source_kind = 'sumit_c100' AND decoded = 1 GROUP BY doc_type",
      NEW,
    );
    const docs = await all<{ n: number; total: number }>(
      env.DB,
      "SELECT COUNT(*) AS n, SUM(total_minor) AS total FROM documents WHERE business_id = ? AND number IS NOT NULL AND status = 'final' AND type != 'PR'",
      OLD,
    );
    expect(docs[0]!.n).toBeGreaterThan(0);
    expect(rows.reduce((s, r) => s + r.n, 0)).toBe(docs[0]!.n);
    expect(rows.reduce((s, r) => s + r.total, 0)).toBe(docs[0]!.total);
    for (const r of rows) {
      const perType = (built.summary as unknown as { perType?: Record<string, { count: number; totalIlsMinor: number }> }).perType;
      if (perType?.[r.doc_type]) {
        expect(r.n).toBe(perType[r.doc_type]!.count);
        expect(r.total).toBe(perType[r.doc_type]!.totalIlsMinor);
      }
    }
  });
});
