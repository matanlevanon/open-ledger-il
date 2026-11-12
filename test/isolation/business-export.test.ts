import { env } from 'cloudflare:workers';
import { unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { run } from '../../src/core/db';
import { createApp } from '../../src/index';
import { sha256Bytes } from '../../src/modules/business-export';
import { makeKey } from '../modules/api/helpers';

/**
 * R48 task 4: export one business. Two businesses with overlapping client names and one shared
 * receipt file. The export of A holds only A's rows and files, every hash matches, and no token
 * or key appears in any file.
 */
const app = createApp();
const OWNER = 'owner@example.com';
const OWNER_B = 'noauto-export-owner-b@example.com';
const TODAY = '2026-11-12';

async function call(email: string, businessId: number, method: string, path: string, body?: unknown) {
  const res = await app.request(
    `/api${path}`,
    { method, headers: { 'content-type': 'application/json', 'X-Business-Id': String(businessId) }, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: email },
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

let A = 0;
let B = 0;
const SECRET_STRINGS: string[] = [];

beforeAll(async () => {
  await call(OWNER, 1, 'GET', '/businesses');
  A = (await call(OWNER, 1, 'POST', '/businesses', { entityType: 'company', nameEn: 'Export A Ltd', nameHe: 'א', taxId: '514000108', addressEn: 'X' })).json.businessId;
  B = (await call(OWNER, 1, 'POST', '/businesses', { entityType: 'company', nameEn: 'Export B Ltd', nameHe: 'ב', taxId: '514000116', addressEn: 'X' })).json.businessId;
  await call(OWNER, B, 'POST', '/access/users', { email: OWNER_B, role: 'owner' });
  for (const [biz, email] of [
    [A, 'a-client@example.com'],
    [B, 'b-client@example.com'],
  ] as const) {
    const client = (await call(OWNER, biz, 'POST', '/clients', { nameEn: 'Same Name Client', country: 'IL', email })).json;
    const draft = (await call(OWNER, biz, 'POST', '/documents', { type: 'PR', clientId: client.client.id, date: TODAY, lines: [{ description: `Work ${biz}`, unitPriceMinor: 1000 * biz }] })).json;
    await call(OWNER, biz, 'POST', `/documents/${draft.document.id}/finalize`, {});
  }
  // One receipt file, the same bytes, referenced by an expense in each business.
  await env.FILES.put('expenses/shared-receipt.pdf', '%PDF shared receipt');
  for (const biz of [A, B]) {
    const file = await run(
      env.DB,
      "INSERT INTO expense_files (source, r2_key, filename, content_type, size_bytes, sha256, business_id) VALUES ('upload', 'expenses/shared-receipt.pdf', 'receipt.pdf', 'application/pdf', 19, 'shared', ?)",
      biz,
    );
    await run(env.DB, "INSERT INTO expenses (file_id, document_date, amount_minor, notes, business_id) VALUES (?, '2026-10-01', 500, ?, ?)", file.lastRowId, `note of ${biz}`, biz);
  }
  await env.FILES.put('business/only-b.pdf', 'b only file');
  await run(
    env.DB,
    "INSERT INTO business_documents (business_id, type, r2_key, sha256, file_name, content_type, size_bytes) VALUES (?, 'vat_registration', 'business/only-b.pdf', 'b', 'b.pdf', 'application/pdf', 11)",
    B,
  );
  // Secrets that must never appear in an export.
  SECRET_STRINGS.push((await makeKey('read', A, 'A key')).key);
  await run(env.DB, "INSERT INTO mcp_tokens (token_hash, last4, created_by, business_id) VALUES (?, 'abcd', 'test', ?)", 'f'.repeat(64), A);
  SECRET_STRINGS.push('f'.repeat(64));
});

describe('R48 export one business', () => {
  let files: Record<string, Uint8Array> = {};
  let manifest: any;

  it('builds every file of a run, one request each, and completes the run', async () => {
    const started = await call(OWNER, A, 'POST', '/business-export/runs');
    expect(started.status).toBe(201);
    const runId = started.json.run.id as string;
    const names = started.json.run.files.map((f: { name: string }) => f.name) as string[];
    expect(names[0]).toBe('data.json');
    expect(names.at(-1)).toBe('manifest.json');
    expect(names).toEqual(expect.arrayContaining(['unified-file-2026.zip', 'documents-2026.zip', 'expenses-2026.csv', 'expenses-2026.zip', 'contracts-and-business-documents.zip']));
    // The manifest waits for the other files.
    expect((await call(OWNER, A, 'POST', `/business-export/runs/${runId}/files/manifest.json`)).status).toBe(409);
    let last: any;
    for (const name of names) {
      last = await call(OWNER, A, 'POST', `/business-export/runs/${runId}/files/${encodeURIComponent(name)}`);
      expect(last.status, name).toBe(200);
    }
    expect(last.json.run.completedAt).not.toBeNull();
    for (const f of last.json.run.files) {
      const res = await call(OWNER, A, 'GET', f.links[0]);
      expect(res.status, f.name).toBe(200);
      files[f.name] = res.buf;
      expect(await sha256Bytes(res.buf), f.name).toBe(f.sha256);
    }
    manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  });

  it('the manifest names every file with a matching hash, the row counts and the next numbers', async () => {
    for (const [name, f] of Object.entries(manifest.files) as [string, { sha256: string }][]) {
      expect(await sha256Bytes(files[name]!), name).toBe(f.sha256);
    }
    expect(manifest.business.taxId).toBe('514000108');
    expect(manifest.rowCounts.documents).toBe(1);
    expect(manifest.rowCounts.expenses).toBe(1);
    expect(manifest.hashChainHead).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.startNumbers.find((s: { docType: string }) => s.docType === 'PR')).toBeTruthy();
    expect(manifest.lastMigration).toMatch(/^\d{4}_/);
  });

  it("holds only A's rows and files", async () => {
    const data = JSON.parse(new TextDecoder().decode(files['data.json']));
    expect(data.business.id).toBe(A);
    expect(data.clients.map((c: { email: string }) => c.email)).toEqual(['a-client@example.com']);
    const csv = new TextDecoder().decode(files['expenses-2026.csv']);
    expect(csv).toContain(`note of ${A}`);
    expect(csv).not.toContain(`note of ${B}`);
    expect(Object.keys(unzipSync(files['expenses-2026.zip']!))).toHaveLength(1);
    expect(Object.keys(unzipSync(files['contracts-and-business-documents.zip']!))).toHaveLength(0);
    const all = Object.values(files).map((b) => new TextDecoder('latin1').decode(b)).join('\n');
    expect(all).not.toContain('b-client@example.com');
    expect(all).not.toContain('Export B Ltd');
  });

  it('holds no token, key or secret', () => {
    const all = Object.values(files)
      .map((b) => new TextDecoder().decode(b))
      .join('\n');
    for (const s of SECRET_STRINGS) expect(all).not.toContain(s);
    expect(all).not.toContain('PRIVATE KEY');
    expect(all).not.toContain('refresh_token');
    expect(all).not.toContain('key_hash');
  });

  it('another business owner cannot read the run', async () => {
    const runs = await call(OWNER, A, 'GET', '/business-export/runs');
    const runId = runs.json.runs[0].id;
    expect((await call(OWNER_B, B, 'GET', `/business-export/runs/${runId}`)).status).toBe(404);
    expect((await call(OWNER_B, A, 'GET', `/business-export/runs/${runId}`)).status).toBe(403);
  });
});
