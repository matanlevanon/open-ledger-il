import { beforeAll, describe, expect, it } from 'vitest';
import { all, first } from '../../../src/core/db';
import { copySandbox, ensureMasters, mastersCurrent } from '../../../src/modules/demo/sample';
import { verifyPdf } from '../../../src/modules/signing';
import { demoTestEnv } from './helpers';

/** R26 task 2 and 4: the master sample set, and a sandbox copy timed against the 5-second budget. */
const env = demoTestEnv();
let masters: number[] = [];

beforeAll(async () => {
  masters = (await ensureMasters({ env })).businessIds;
}, 120_000);

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

describe('a sandbox copy', () => {
  it('copies both masters through the normal finalize path in under 5 seconds', async () => {
    const owner = { userId: (await first<{ id: number }>(env.DB, "INSERT INTO users (email, role) VALUES ('noauto-visitor-copy@sandbox.invalid', 'owner') RETURNING id"))!.id, email: 'noauto-visitor-copy@sandbox.invalid' };
    const started = Date.now();
    const ids = await copySandbox({ env }, owner);
    const ms = Date.now() - started;
    console.log(`sandbox copy: ${ms} ms`);
    expect(ms).toBeLessThan(5000);
    expect(ids).toHaveLength(2);
    const masterDocs = (await first<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM documents WHERE business_id = ? AND number IS NOT NULL`, masters[0]))!.n;
    const copyDocs = (await first<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM documents WHERE business_id = ? AND number IS NOT NULL`, ids[0]))!.n;
    expect(copyDocs).toBe(masterDocs);
    // Real numbering per sandbox: its own series, starting at 1, a hash chain of its own.
    const first400 = await first<{ number: number; prev_hash: string | null }>(env.DB, "SELECT number, prev_hash FROM documents WHERE business_id = ? AND type = '400' ORDER BY number LIMIT 1", ids[0]);
    expect(first400!.number).toBe(1);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const newest = (await first<{ d: string }>(env.DB, 'SELECT MAX(date) AS d FROM documents WHERE business_id = ?', ids[0]))!.d;
    expect(newest).toBe(yesterday);
    expect((await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM contracts WHERE business_id = ?', ids[1]))!.n).toBe(2);
    expect((await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM expenses WHERE business_id = ?', ids[1]))!.n).toBe(6);
  });
});
