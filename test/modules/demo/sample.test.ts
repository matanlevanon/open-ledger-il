import { beforeAll, describe, expect, it } from 'vitest';
import { all, first } from '../../../src/core/db';
import { ensureMasters, fingerprintOf, mastersCurrent, refreshFingerprint, staleMasters, takeBuildLock } from '../../../src/modules/demo/sample';
import { verifyPdf } from '../../../src/modules/signing';
import { demoTestEnv } from './helpers';

/** R26 task 2, R29 task 6: the master sample set, built once under a lock. */
const env = demoTestEnv();
let masters: number[] = [];
let racers: Awaited<ReturnType<typeof ensureMasters>>[] = [];

beforeAll(async () => {
  // Two first requests at once: one builds, the other is told to wait.
  racers = await Promise.all([ensureMasters({ env }), ensureMasters({ env })]);
  masters = (await ensureMasters({ env })).businessIds;
}, 180_000);

describe('the build', () => {
  it('two concurrent first requests build the masters once', async () => {
    expect(racers.filter((r) => r.ready && r.loaded)).toHaveLength(1);
    expect(racers.filter((r) => !r.ready)).toHaveLength(1);
    const names = await all<{ name_en: string; n: number }>(env.DB, "SELECT name_en, COUNT(*) AS n FROM businesses WHERE name_en IN ('Noa Levi Studio', 'Demo Studio Ltd') GROUP BY name_en");
    expect(names.map((r) => r.n)).toEqual([1, 1]);
    // The lock is released after the build.
    expect(await first(env.DB, 'SELECT 1 FROM demo_build_lock')).toBeNull();
  });

  it('a running build holds the lock, and a stale lock is taken over', async () => {
    const t = new Date('2026-10-13T10:00:00Z');
    expect(await takeBuildLock(env.DB, 'first', t)).toBe(true);
    expect(await takeBuildLock(env.DB, 'second', new Date(t.getTime() + 60_000))).toBe(false);
    expect(await takeBuildLock(env.DB, 'third', new Date(t.getTime() + 11 * 60_000))).toBe(true);
    await env.DB.prepare('DELETE FROM demo_build_lock').run();
  });

  it('lists a master only with its fingerprint, and sees a changed sample set', async () => {
    const rows = await all<{ fingerprint: string | null }>(env.DB, 'SELECT fingerprint FROM demo_master_businesses');
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.fingerprint ?? ''))).toBe(true);
    expect(await staleMasters(env.DB)).toEqual([]);
    // A visitor's draft is not part of the sample set.
    await env.DB.prepare("INSERT INTO clients (name_en, country, currency, business_id, demo_session_id) VALUES ('Visitor draft client', 'IL', 'ILS', ?, 'aaaaaaaa-bbbb')").bind(masters[0]).run();
    expect(await staleMasters(env.DB)).toEqual([]);
    // A changed sample row is.
    const client = (await first<{ id: number; name_en: string }>(env.DB, 'SELECT id, name_en FROM clients WHERE business_id = ? AND demo_session_id IS NULL ORDER BY id LIMIT 1', masters[0]))!;
    await env.DB.prepare("UPDATE clients SET name_en = 'Changed' WHERE id = ?").bind(client.id).run();
    expect((await staleMasters(env.DB)).map((s) => s.businessId)).toEqual([masters[0]]);
    // An admin write becomes the new reference.
    await refreshFingerprint(env.DB, masters[0]!);
    expect(await staleMasters(env.DB)).toEqual([]);
    await env.DB.prepare('UPDATE clients SET name_en = ? WHERE id = ?').bind(client.name_en, client.id).run();
    await refreshFingerprint(env.DB, masters[0]!);
    await env.DB.prepare("DELETE FROM clients WHERE demo_session_id = 'aaaaaaaa-bbbb'").run();
    expect(await fingerprintOf(env.DB, masters[0]!)).toBe((await first<{ fingerprint: string }>(env.DB, 'SELECT fingerprint FROM demo_master_businesses WHERE business_id = ?', masters[0]))!.fingerprint);
  });
});

describe('the master sample set', () => {
  it('loads two masters: an עוסק פטור and a company, once', async () => {
    expect(masters).toHaveLength(2);
    expect(await mastersCurrent(env.DB)).toBe(true);
    const again = await ensureMasters({ env });
    expect(again.loaded).toBe(false);
    const rows = await all<{ name_en: string; entity_type: string; tax_id: string }>(env.DB, `SELECT name_en, entity_type, tax_id FROM businesses WHERE id IN (${masters.join(',')}) ORDER BY id`);
    expect(rows).toEqual([
      { name_en: 'Noa Levi Studio', entity_type: 'osek_patur', tax_id: '000000018' },
      { name_en: 'Demo Studio Ltd', entity_type: 'company', tax_id: '599999901' },
    ]);
  });

  it('holds 8 clients, about 30 final documents with a credit and a cancellation, 12 expenses and 4 contracts', async () => {
    const ids = masters.join(',');
    const count = async (sql: string) => (await first<{ n: number }>(env.DB, sql))!.n;
    expect(await count(`SELECT COUNT(*) AS n FROM clients WHERE business_id IN (${ids})`)).toBe(8);
    const docs = await count(`SELECT COUNT(*) AS n FROM documents WHERE business_id IN (${ids}) AND number IS NOT NULL`);
    expect(docs).toBeGreaterThanOrEqual(28);
    expect(await count(`SELECT COUNT(*) AS n FROM documents WHERE business_id IN (${ids}) AND status = 'cancelled'`)).toBe(1);
    expect(await count(`SELECT COUNT(*) AS n FROM documents WHERE business_id IN (${ids}) AND type IN ('405', '330')`)).toBe(2);
    expect(await count(`SELECT COUNT(*) AS n FROM expenses WHERE business_id IN (${ids})`)).toBe(12);
    expect(await count(`SELECT COUNT(*) AS n FROM contracts WHERE business_id IN (${ids})`)).toBe(4);
    expect(await count(`SELECT COUNT(*) AS n FROM contracts WHERE business_id IN (${ids}) AND status = 'signed'`)).toBe(2);
    // No real contact data: example.com emails, 050-0000000 phones.
    const emails = await all<{ email: string | null }>(env.DB, `SELECT email FROM clients WHERE business_id IN (${ids})`);
    for (const e of emails) expect(e.email).toMatch(/example\.com$/);
    const phones = await all<{ phone: string | null }>(env.DB, `SELECT phone FROM clients WHERE business_id IN (${ids}) AND phone IS NOT NULL`);
    for (const p of phones) expect(p.phone).toMatch(/^050-00000\d\d$/);
  });

  it('a signed sample contract carries the demo certificate signature and an evidence page', async () => {
    const row = (await first<{ signed_pdf_r2_key: string }>(env.DB, `SELECT signed_pdf_r2_key FROM contracts WHERE business_id = ? AND status = 'signed'`, masters[0]))!;
    const pdf = new Uint8Array(await (await env.FILES.get(row.signed_pdf_r2_key))!.arrayBuffer());
    const verified = await verifyPdf(pdf);
    expect(verified.valid).toBe(true);
    expect(verified.signerCommonName).toBe('Open Ledger IL Demo, not valid');
  });

  it('the patur ceiling meter shows about 60% used', async () => {
    const turnover = (await first<{ n: number }>(env.DB, "SELECT COALESCE(SUM(COALESCE(total_ils_minor, total_minor)), 0) AS n FROM documents WHERE business_id = ? AND type = '400' AND status = 'final'", masters[0]))!.n;
    const ceiling = 12283300;
    expect(turnover / ceiling).toBeGreaterThan(0.5);
    expect(turnover / ceiling).toBeLessThan(0.7);
  });
});

describe('R43: the sample company has bank data', () => {
  it('builds a connection, four accounts and transactions with every status, and the daily sync skips it', async () => {
    const company = (await first<{ id: number }>(env.DB, "SELECT id FROM businesses WHERE name_en = 'Demo Studio Ltd'"))!.id;
    const studio = (await first<{ id: number }>(env.DB, "SELECT id FROM businesses WHERE name_en = 'Noa Levi Studio'"))!.id;
    const conn = await first<{ status: string; client_secret_enc: string | null; account_ids: string }>(env.DB, 'SELECT * FROM financy_connection WHERE business_id = ?', company);
    expect(conn).toMatchObject({ status: 'connected', client_secret_enc: null });
    expect(JSON.parse(conn!.account_ids)).toHaveLength(4);
    expect(await first(env.DB, 'SELECT 1 FROM financy_connection WHERE business_id = ?', studio)).toBeNull();
    const accounts = await all(env.DB, 'SELECT 1 FROM bank_accounts WHERE business_id = ?', company);
    expect(accounts).toHaveLength(4);
    const rows = await all<{ match_status: string; flow: string; matched_document_id: number | null }>(
      env.DB,
      'SELECT match_status, flow, matched_document_id FROM bank_transactions WHERE business_id = ?',
      company,
    );
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.some((r) => r.match_status === 'matched')).toBe(true);
    expect(rows.some((r) => r.matched_document_id !== null)).toBe(true);
    expect(rows.some((r) => r.flow === 'card_payment')).toBe(true);
    expect(rows.some((r) => r.match_status === 'unmatched' && r.flow === 'normal')).toBe(true);
    const { syncAllDaily } = await import('../../../src/modules/financy/sync');
    expect(await syncAllDaily(env, { fetch: () => Promise.reject(new Error('no network')) })).toEqual({ synced: 0, failed: 0 });
  });
});
