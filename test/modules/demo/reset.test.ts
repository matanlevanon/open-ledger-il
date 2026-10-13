import { beforeAll, describe, expect, it } from 'vitest';
import { all, first, run } from '../../../src/core/db';
import { createClient } from '../../../src/modules/clients/service';
import { clientInput } from '../../../src/modules/clients/schemas';
import { createContractDraft } from '../../../src/modules/contracts/service';
import { contractInput } from '../../../src/modules/contracts/types';
import { buildDocumentsServices } from '../../../src/modules/documents';
import { draftInput } from '../../../src/modules/documents/schemas';
import { createDraft } from '../../../src/modules/documents/service';
import { recordConsent, upsertLead } from '../../../src/modules/demo/leads';
import { runReset, runSweep } from '../../../src/modules/demo/reset';
import { ensureMasters, staleMasters } from '../../../src/modules/demo/sample';
import { demoTestEnv, testVisitor } from './helpers';

/**
 * R29 task 5: the sweep and the nightly reset against a local D1. Expired sessions go with every
 * row and file tagged with them. The reset removes every visitor row, every business not listed
 * as a master, and a master that changed. Masters that did not change stay byte for byte, every
 * trigger comes back exactly, leads and consents stay, and a failure in the middle leaves
 * everything as it was.
 */
const env = demoTestEnv();
const notifier = { messages: [] as string[], async send(t: string) { this.messages.push(t); return true; } };
let masters: number[] = [];

const TAGGED = ['documents', 'clients', 'contracts', 'expenses', 'expense_files', 'suppliers', 'demo_outbox'];
const count = async (sql: string, ...p: (string | number)[]) => (await first<{ n: number }>(env.DB, sql, ...p))!.n;
const triggerList = async () => JSON.stringify(await all(env.DB, "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name"));
const keptRows = async () => JSON.stringify([await all(env.DB, 'SELECT * FROM demo_leads ORDER BY id'), await all(env.DB, 'SELECT * FROM demo_consents ORDER BY id'), await all(env.DB, 'SELECT * FROM demo_usage ORDER BY day, scope, kind')]);

/** Every sample row of the masters, read independently of the reset code. */
async function sampleRows(ids = masters): Promise<string> {
  const parts: string[] = [];
  for (const t of ['clients', 'documents', 'contracts', 'expenses', 'contract_templates', 'series']) {
    const where = TAGGED.includes(t) ? ' AND demo_session_id IS NULL' : '';
    parts.push(`${t}:${JSON.stringify(await all(env.DB, `SELECT * FROM "${t}" WHERE business_id IN (${ids.join(',')})${where} ORDER BY rowid`))}`);
  }
  parts.push(`lines:${JSON.stringify(await all(env.DB, `SELECT * FROM document_lines WHERE document_id IN (SELECT id FROM documents WHERE business_id IN (${ids.join(',')}) AND demo_session_id IS NULL) ORDER BY rowid`))}`);
  return parts.join('\n');
}

/** A visitor with a client, a draft with lines, a contract draft, an uploaded expense with its file, and an outbox email. */
async function visitorWithRows(label: string) {
  const lead = await upsertLead(env.DB, { name: label, email: `${label}@example.com`, ip: null, userAgent: null });
  await recordConsent(env, lead, true, 'en', null);
  const v = await testVisitor(env, masters, label);
  await run(env.DB, 'UPDATE demo_sessions SET lead_id = ? WHERE session_key = ?', lead.id, v.key);
  const biz = masters[0]!;
  const clientId = await createClient(v.db, v.actor(biz), clientInput.parse({ nameEn: `${label} client`, country: 'IL', currency: 'ILS' }));
  const ctx = { db: v.db, actor: v.actor(biz), user: v.user(biz), services: buildDocumentsServices({}, v.env) };
  const docId = await createDraft(ctx, draftInput.parse({ type: 'PR', clientId, lines: [{ description: 'Visitor work', unitPriceMinor: 5000 }] }));
  const template = (await first<{ id: number }>(env.DB, "SELECT id FROM contract_templates WHERE business_id = ? AND name = 'Service Agreement'", biz))!.id;
  const contractId = await createContractDraft(v.db, v.env, v.actor(biz), contractInput.parse({ clientId, templateId: template, signer: { name: 'Signer', email: 'signer@example.com' } }));
  const fileKey = `business/${biz}/expenses/${label}-upload.png`;
  await env.FILES.put(fileKey, 'visitor upload');
  const file = await run(v.db, "INSERT INTO expense_files (source, r2_key, filename, content_type, size_bytes, sha256, business_id) VALUES ('upload', ?, 'r.png', 'image/png', 14, ?, ?)", fileKey, `${label}-sha`, biz);
  const expense = await run(v.db, "INSERT INTO expenses (file_id, status, currency, amount_minor, vat_amount_minor, amount_ils_minor, business_id) VALUES (?, 'new', 'ILS', 1000, 0, 1000, ?)", file.lastRowId, biz);
  await run(v.db, 'UPDATE expense_files SET expense_id = ? WHERE id = ?', expense.lastRowId, file.lastRowId);
  // A visitor upload that matches a sample receipt's content shares its stored file.
  const sampleKey = (await first<{ r2_key: string }>(env.DB, 'SELECT r2_key FROM expense_files WHERE business_id = ? AND demo_session_id IS NULL LIMIT 1', biz))!.r2_key;
  await run(v.db, "INSERT INTO expense_files (source, r2_key, filename, content_type, size_bytes, sha256, business_id) VALUES ('upload', ?, 'same.png', 'image/png', 1, 'same', ?)", sampleKey, biz);
  await run(v.db, 'INSERT INTO demo_outbox (business_id, to_addr, subject, html, text) VALUES (?, ?, ?, ?, ?)', biz, 'c@example.com', 'Preview', '<p>x</p>', 'x');
  return { ...v, clientId, docId, contractId, fileKey, sampleKey };
}

async function rowsOf(key: string): Promise<number> {
  let n = 0;
  for (const t of TAGGED) n += await count(`SELECT COUNT(*) AS n FROM "${t}" WHERE demo_session_id = ?`, key);
  return n;
}

beforeAll(async () => {
  const built = await ensureMasters({ env });
  masters = built.businessIds;
}, 120_000);

describe('the sweep', () => {
  it('removes an expired session, its user, its rows and its files, and nothing else', async () => {
    const a = await visitorWithRows('swept');
    const b = await visitorWithRows('live');
    expect(await rowsOf(a.key)).toBeGreaterThanOrEqual(7);
    const beforeSample = await sampleRows();
    const beforeTriggers = await triggerList();
    const beforeKept = await keptRows();
    await run(env.DB, 'UPDATE demo_sessions SET expires_at = ? WHERE session_key = ?', new Date(Date.now() - 60_000).toISOString(), a.key);

    const result = await runSweep({ db: env.DB, files: env.FILES, notifier });
    expect(result).toMatchObject({ ok: true, sessionsRemoved: 1 });
    expect(result.filesRemoved).toBe(1);

    expect(await rowsOf(a.key)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM document_lines WHERE document_id = ?', a.docId)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM contract_events WHERE contract_id = ?', a.contractId)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM users WHERE id = ?', a.userId)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM user_businesses WHERE user_id = ?', a.userId)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM demo_sessions WHERE session_key = ?', a.key)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?', a.userId)).toBe(0);
    expect(await env.FILES.head(a.fileKey)).toBeNull();
    // The sample receipt the visitor's upload shared stays.
    expect(await env.FILES.head(a.sampleKey)).not.toBeNull();

    // The live visitor, the sample set, the locks, leads and consents: as they were.
    expect(await rowsOf(b.key)).toBeGreaterThanOrEqual(7);
    expect(await env.FILES.head(b.fileKey)).not.toBeNull();
    expect(await sampleRows()).toBe(beforeSample);
    expect(await triggerList()).toBe(beforeTriggers);
    expect(await keptRows()).toBe(beforeKept);
    expect((await first<{ ok: number; sessions_removed: number }>(env.DB, 'SELECT ok, sessions_removed FROM demo_sweeps ORDER BY id DESC LIMIT 1'))!).toEqual({ ok: 1, sessions_removed: 1 });

    // Nothing expired: a quiet run, still logged.
    expect((await runSweep({ db: env.DB, files: env.FILES })).sessionsRemoved).toBe(0);
  });
});

describe('the nightly reset', () => {
  it('removes every visitor row and session, keeps an unchanged sample set, the locks, leads and consents', async () => {
    const c = await visitorWithRows('nightly');
    const beforeSample = await sampleRows();
    const beforeTriggers = await triggerList();
    const beforeKept = await keptRows();
    const sampleFiles = async () => (await env.FILES.list({ prefix: `business/${masters[0]}/` })).objects.map((o) => o.key).filter((k) => !k.endsWith('-upload.png'));
    const files = await sampleFiles();

    const result = await runReset({ db: env.DB, files: env.FILES, trigger: 'test', notifier });
    expect(result).toMatchObject({ ok: true, mastersUnchanged: true, mastersRebuilt: [], businessesRemoved: [] });
    expect(result.sandboxesRemoved).toBeGreaterThanOrEqual(2);
    expect(result.triggersAfter).toBe(result.triggersBefore);

    for (const t of TAGGED) expect(await count(`SELECT COUNT(*) AS n FROM "${t}" WHERE demo_session_id IS NOT NULL`), t).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE email LIKE 'visitor-%'")).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM demo_sessions WHERE admin = 0')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM document_lines WHERE document_id NOT IN (SELECT id FROM documents)')).toBe(0);
    expect(await env.FILES.head(c.fileKey)).toBeNull();
    expect(await sampleRows()).toBe(beforeSample);
    expect(await triggerList()).toBe(beforeTriggers);
    expect(await keptRows()).toBe(beforeKept);
    expect((await env.FILES.list({ prefix: `business/${masters[0]}/` })).objects.map((o) => o.key)).toEqual(files);
    // The locks work again after the reset.
    const doc = (await first<{ id: number }>(env.DB, `SELECT id FROM documents WHERE business_id = ? AND status = 'final' LIMIT 1`, masters[0]))!.id;
    await expect(run(env.DB, 'DELETE FROM documents WHERE id = ?', doc)).rejects.toThrow();
  });

  it('removes a business not listed as a master and a changed master, then the build replaces it', async () => {
    // A leftover from before R29: a business no list names. And a sample row changed by mistake.
    const leftover = (await first<{ id: number }>(env.DB, "INSERT INTO businesses (name_en, name_he, entity_type) VALUES ('Old sandbox', 'ארגז ישן', 'osek_patur') RETURNING id"))!.id;
    await env.FILES.put(`business/${leftover}/documents/old.pdf`, '%PDF-1.4 old');
    const client = (await first<{ id: number }>(env.DB, 'SELECT id FROM clients WHERE business_id = ? AND demo_session_id IS NULL ORDER BY id LIMIT 1', masters[1]))!.id;
    await run(env.DB, "UPDATE clients SET name_en = 'Changed by mistake' WHERE id = ?", client);
    const keptMaster = await sampleRows([masters[0]!]);

    const result = await runReset({ db: env.DB, files: env.FILES, trigger: 'test', notifier });
    expect(result.ok).toBe(true);
    expect(result.businessesRemoved.sort()).toEqual([leftover, masters[1]].sort());
    expect(result.mastersRebuilt).toEqual(['company']);
    expect(await count('SELECT COUNT(*) AS n FROM businesses WHERE id IN (?, ?)', leftover, masters[1]!)).toBe(0);
    expect((await env.FILES.list({ prefix: `business/${leftover}/` })).objects).toHaveLength(0);
    expect(await sampleRows([masters[0]!])).toBe(keptMaster);

    const rebuilt = await ensureMasters({ env });
    expect(rebuilt).toMatchObject({ ready: true, loaded: true });
    expect(rebuilt.businessIds).toContain(masters[0]);
    expect(await count("SELECT COUNT(*) AS n FROM clients WHERE name_en = 'Changed by mistake'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM businesses WHERE name_en = 'Demo Studio Ltd'")).toBe(1);
    expect(await staleMasters(env.DB)).toEqual([]);
    masters = rebuilt.businessIds;
  }, 120_000);

  it('a failure in the middle rolls everything back, alerts Slack and records the failure', async () => {
    const d = await visitorWithRows('rollback');
    const beforeSample = await sampleRows();
    const beforeTriggers = await triggerList();
    notifier.messages = [];

    const result = await runReset({ db: env.DB, files: env.FILES, trigger: 'test', notifier, failInside: true });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Rolled back');
    expect(notifier.messages.some((m) => m.includes('rolled back'))).toBe(true);

    expect(await sampleRows()).toBe(beforeSample);
    expect(await triggerList()).toBe(beforeTriggers);
    expect(await rowsOf(d.key)).toBeGreaterThanOrEqual(7);
    expect(await env.FILES.head(d.fileKey)).not.toBeNull();
    expect((await first<{ ok: number }>(env.DB, 'SELECT ok FROM demo_resets ORDER BY id DESC LIMIT 1'))!.ok).toBe(0);
  });

  it('skips while the sample data is being built', async () => {
    await run(env.DB, "INSERT INTO demo_build_lock (id, holder, started_at, expires_at) VALUES (1, 'build', ?, ?)", new Date().toISOString(), new Date(Date.now() + 60_000).toISOString());
    const result = await runReset({ db: env.DB, files: env.FILES, trigger: 'test' });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('being built');
    await run(env.DB, 'DELETE FROM demo_build_lock');
  });
});
