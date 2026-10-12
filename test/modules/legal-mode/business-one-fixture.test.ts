import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../../src/core/audit';
import { GENESIS_HASH, buildDocumentRecord, computeHash, loadDocument, verifyChainFromTables } from '../../../src/core/hashchain';
import { finalizeDocument } from '../../../src/core/numbering';
import { runGapCheck } from '../../../src/modules/ops/checks';

/**
 * R24 Done-when: business 1 after every R24 migration is identical to before. The scratch database
 * is migrated to just before R24, filled like a live Ledger that already switched to מורשה, then
 * the R24 migrations run and every row is compared. Each later phase adds its migrations here.
 */
const R24_FIRST = '2400';
const scratch = () => env.SCRATCH_DB;

async function snapshot(table: string, columns: string): Promise<unknown[]> {
  return (await scratch().prepare(`SELECT ${columns} FROM ${table} ORDER BY 1`).all()).results;
}

/** The series a document type draws from today. */
async function seriesFor(docType: string): Promise<string> {
  const row = await scratch().prepare('SELECT id FROM series WHERE doc_type = ? AND closed_at IS NULL').bind(docType).first<{ id: string }>();
  if (!row) throw new Error(`No open series for ${docType}`);
  return row.id;
}

/** A draft with one line and, for a receipt, one payment. Raw SQL, so it runs on the pre-R24 schema. */
async function draft(docType: string, clientId: number, date: string, amountMinor: number): Promise<number> {
  const seriesId = await seriesFor(docType);
  const res = await scratch()
    .prepare(
      `INSERT INTO documents (type, series_id, legal_mode, client_id, date, currency, subtotal_minor, total_minor, total_ils_minor)
       VALUES (?, ?, 'patur', ?, ?, 'ILS', ?, ?, ?)`,
    )
    .bind(docType, seriesId, clientId, date, amountMinor, amountMinor, amountMinor)
    .run();
  const id = Number(res.meta.last_row_id);
  await scratch()
    .prepare(
      `INSERT INTO document_lines (document_id, position, description_en, quantity_milli, unit_price_minor, line_total_minor)
       VALUES (?, 1, 'Consulting', 1000, ?, ?)`,
    )
    .bind(id, amountMinor, amountMinor)
    .run();
  if (docType === '400') {
    await scratch()
      .prepare(`INSERT INTO payments (document_id, method, paid_on, amount_minor, currency, amount_ils_minor) VALUES (?, 'bank_transfer', ?, ?, 'ILS', ?)`)
      .bind(id, date, amountMinor, amountMinor)
      .run();
  }
  return id;
}

/**
 * Finalize exactly as the code before R24 did: next number of the series, prev_hash from the last
 * finalization of the whole Ledger, the hash over the frozen record. The pre-R24 triggers check it.
 */
async function finalizeBeforeR24(documentId: number): Promise<void> {
  const loaded = (await loadDocument(scratch(), documentId))!;
  const doc = loaded.row;
  const series = (await scratch().prepare('SELECT next_number FROM series WHERE id = ?').bind(doc.series_id).first<{ next_number: number }>())!;
  const head = await scratch().prepare('SELECT hash FROM finalizations ORDER BY seq DESC LIMIT 1').first<{ hash: string }>();
  const prevHash = head?.hash ?? GENESIS_HASH;
  const finalizedAt = new Date().toISOString();
  const number = series.next_number;
  const hash = await computeHash(buildDocumentRecord({ ...doc, number, finalized_at: finalizedAt, hash_schema_version: 2 }, loaded.lines, loaded.payments), prevHash);
  await scratch().batch([
    scratch()
      .prepare('INSERT INTO finalizations (document_id, series_id, number, doc_version, prev_hash, hash, finalized_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(documentId, doc.series_id, number, Number(doc.version), prevHash, hash, finalizedAt),
    scratch()
      .prepare(
        `UPDATE documents SET status = 'final', number = ?, hash = ?, prev_hash = ?, finalized_at = ?, updated_at = ?, hash_schema_version = 2
         WHERE id = ? AND status = 'draft'`,
      )
      .bind(number, hash, prevHash, finalizedAt, finalizedAt, documentId),
  ]);
}

// Every table that holds business 1 data, read through the columns it had before R24.
const TABLES = [
  'business_profile',
  'legal_modes',
  'series',
  'clients',
  'documents',
  'document_lines',
  'payments',
  'document_links',
  'finalizations',
  'ita_tokens',
  'accountant_packs',
  'suppliers',
  'expenses',
  'vat_rates',
  'ceilings',
  'settings',
  'users',
];

describe('business 1 across the R24 migrations', () => {
  it('keeps every row, the numbers and the hash chain, and the next receipt continues both', async () => {
    const before = env.TEST_MIGRATIONS.filter((m) => m.name < R24_FIRST);
    const r24 = env.TEST_MIGRATIONS.filter((m) => m.name >= R24_FIRST);
    expect(r24.length).toBeGreaterThan(0);
    await applyD1Migrations(scratch(), before);

    await scratch().batch([
      scratch().prepare(
        "UPDATE business_profile SET name_en = 'Sample Business', name_he = 'עסק לדוגמה', address_en = 'Tel Aviv', tax_id = '123456782', email = 'owner@example.com' WHERE id = 1",
      ),
      scratch().prepare("INSERT INTO clients (name_en, country) VALUES ('Client One', 'IL')"),
    ]);
    const clientId = Number((await scratch().prepare('SELECT id FROM clients').first<{ id: number }>())!.id);

    // Three receipts, a credit against the first, and a fourth receipt cancelled after it was final.
    const receipts: number[] = [];
    for (const [i, date] of ['2026-06-01', '2026-06-15', '2026-07-01'].entries()) {
      const id = await draft('400', clientId, date, 100_000 * (i + 1));
      await finalizeBeforeR24(id);
      receipts.push(id);
    }
    const credit = await draft('405', clientId, '2026-07-10', 50_000);
    await scratch().prepare("INSERT INTO document_links (source_id, target_id, kind, amount_minor, currency) VALUES (?, ?, 'credit', 50000, 'ILS')").bind(receipts[0], credit).run();
    await finalizeBeforeR24(credit);
    const cancelled = await draft('400', clientId, '2026-07-20', 70_000);
    await finalizeBeforeR24(cancelled);
    await scratch()
      .prepare("UPDATE documents SET status = 'cancelled', cancelled_at = '2026-07-21T09:00:00.000Z', cancel_reason = 'Issued twice', updated_at = ? WHERE id = ? AND status = 'final'")
      .bind(new Date().toISOString(), cancelled)
      .run();

    // The switch to מורשה, an ITA token, an accountant pack and an expense.
    await scratch().batch([
      scratch().prepare("INSERT INTO legal_modes (mode, effective_from, note) VALUES ('murshe', '2026-09-01', 'crossed the ceiling')"),
      scratch().prepare(
        `INSERT INTO ita_tokens (environment, refresh_token_enc, refresh_expires_at, access_token_enc, access_expires_at, login_at, relogin_due_at, rotation)
         VALUES ('sandbox', 'enc-refresh', '2027-01-01T00:00:00.000Z', 'enc-access', '2026-10-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z', 3)`,
      ),
      scratch().prepare(
        `INSERT INTO accountant_packs (period, pdf_key, xlsx_key, zip_key, expense_file_count, income_total_ils_minor, expense_total_ils_minor)
         VALUES ('2026-07', 'packs/2026-07/pack.pdf', 'packs/2026-07/pack.xlsx', 'packs/2026-07/pack.zip', 1, 600000, 12000)`,
      ),
      scratch().prepare("INSERT INTO suppliers (name, tax_id) VALUES ('Office Supplies Ltd', '514000000')"),
    ]);
    await scratch()
      .prepare(
        `INSERT INTO expenses (supplier_id, status, document_number, document_date, currency, amount_minor, vat_amount_minor, amount_ils_minor)
         VALUES ((SELECT id FROM suppliers), 'filed', 'INV-77', '2026-07-05', 'ILS', 12000, 1831, 12000)`,
      )
      .run();

    // The live check reads finalizations.business_id, so before R24 the chain is checked from the rows.
    const rowsOf = async (t: string) => (await scratch().prepare(`SELECT * FROM ${t}`).all<Record<string, unknown>>()).results;
    const chainBefore = await verifyChainFromTables({
      documents: await rowsOf('documents'),
      document_lines: await rowsOf('document_lines'),
      payments: await rowsOf('payments'),
      finalizations: await rowsOf('finalizations'),
      allocation_records: await rowsOf('allocation_records'),
    });
    expect(chainBefore.ok).toBe(true);
    expect(chainBefore.checked).toBe(5);

    const columnsBefore: Record<string, string> = {};
    for (const t of TABLES) {
      const cols = (await scratch().prepare(`PRAGMA table_info(${t})`).all<{ name: string }>()).results.map((c) => c.name);
      columnsBefore[t] = cols.join(', ');
    }
    const was = await Promise.all(TABLES.map((t) => snapshot(t, columnsBefore[t]!)));
    const receiptSeries = await seriesFor('400');
    const nextBefore = (await scratch().prepare('SELECT next_number FROM series WHERE id = ?').bind(receiptSeries).first<{ next_number: number }>())!.next_number;
    const lastHashBefore = (await scratch().prepare('SELECT hash FROM finalizations ORDER BY seq DESC LIMIT 1').first<{ hash: string }>())!.hash;

    await applyD1Migrations(scratch(), r24);

    // Every row and every pre-R24 column, unchanged.
    const now = await Promise.all(TABLES.map((t) => snapshot(t, columnsBefore[t]!)));
    for (const [i, t] of TABLES.entries()) expect({ table: t, rows: now[i] }).toEqual({ table: t, rows: was[i] });
    const added = await scratch().prepare('SELECT entity_type, vat_reporting FROM business_profile WHERE id = 1').first();
    expect(added).toEqual({ entity_type: 'osek_murshe', vat_reporting: 'bimonthly' });
    // Phase B: every existing row is business 1, with one default brand.
    for (const t of ['legal_modes', 'series', 'clients', 'documents', 'finalizations', 'ita_tokens', 'accountant_packs', 'suppliers', 'expenses']) {
      const other = await scratch().prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE business_id IS NOT 1`).first<{ n: number }>();
      expect({ table: t, n: other?.n }).toEqual({ table: t, n: 0 });
    }
    expect(await scratch().prepare('SELECT business_id, is_default, name_en FROM brands').all().then((r) => r.results)).toEqual([
      { business_id: 1, is_default: 1, name_en: '' },
    ]);

    // The chain end to end and the series, through the nightly gap check.
    const after = await runGapCheck(scratch());
    expect(after.ok).toBe(true);
    expect(after.chain.checked).toBe(5);
    expect(after.chain.headHashes[1]).toBe(lastHashBefore);

    // A new receipt, finalized by today's code, takes the next number and links to the old head.
    const fresh = await draft('400', clientId, '2026-10-01', 90_000);
    const result = await finalizeDocument(scratch(), fresh, { actor: SYSTEM_ACTOR });
    expect(result.seriesId).toBe(receiptSeries);
    expect(result.number).toBe(nextBefore);
    expect(result.prevHash).toBe(lastHashBefore);
    const final = await runGapCheck(scratch());
    expect(final.ok).toBe(true);
    expect(final.chain.checked).toBe(6);
    expect(final.chain.headHashes[1]).toBe(result.hash);
  });
});
