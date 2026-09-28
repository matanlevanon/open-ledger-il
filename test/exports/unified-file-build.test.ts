import { env } from 'cloudflare:workers';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/core/db';
import { finalizeDocument } from '../../src/core/numbering';
import { decodeWindows1255 } from '../../src/modules/exports/encoding';
import { buildUnifiedFile } from '../../src/modules/exports/unified-file/build';
import type { Env } from '../../src/env';
import { OWNER_ACTOR, db, makeDraft } from '../helpers';

const CLIENT_VAT = '514713288';

function testEnv(overrides: Partial<Env> = {}): Env {
  return { ...env, ...overrides } as Env;
}

async function makeClient(nameEn: string, vatNumber: string | null = null): Promise<number> {
  const { lastRowId } = await run(db(), 'INSERT INTO clients (name_en, vat_number) VALUES (?, ?)', nameEn, vatNumber);
  return lastRowId;
}

async function finalizeSale(seriesId: string, totalMinor: number, opts: { clientId?: number; date?: string } = {}): Promise<number> {
  const id = await makeDraft({ seriesId, totalMinor });
  await run(db(), 'UPDATE documents SET client_id = ?, date = ? WHERE id = ?', opts.clientId ?? null, opts.date ?? '2026-10-01', id);
  await finalizeDocument(db(), id, { actor: OWNER_ACTOR });
  return id;
}

/** A fresh bookkeeping type and series, so a test can finalize any date without tripping the
 * "no final document dated before the last final in its series" rule against another test's data. */
async function makeFreshBookkeepingSeries(): Promise<string> {
  const code = `TX${crypto.randomUUID().slice(0, 6)}`;
  await run(
    db(),
    `INSERT INTO document_types (code, name_en, name_he, kind, modes, bookkeeping, sort_order, enabled)
     VALUES (?, 'Test receipt', 'בדיקה', 'receipt', 'both', 1, 999, 1)`,
    code,
  );
  await run(db(), `INSERT INTO series (id, doc_type, name_en) VALUES (?, ?, 'Test receipt series')`, code, code);
  return code;
}

describe('buildUnifiedFile (runs/R13-exports.md: unified file for any period, tests: "record counts match data")', () => {
  it('emits one A000, one A100, one C100+D110 per bookkeeping document and one Z900 footer', async () => {
    const client = await makeClient('Acme Ltd', CLIENT_VAT);
    await finalizeSale('400', 100000, { clientId: client, date: '2026-11-05' });
    // R18 task 10 merged 300 into the (non-bookkeeping) proforma, so a second bookkeeping type
    // needs its own fresh one here instead.
    const secondBookkeepingType = await makeFreshBookkeepingSeries();
    await finalizeSale(secondBookkeepingType, 50000, { clientId: client, date: '2026-11-06' });

    const result = await buildUnifiedFile(testEnv(), '2026-11-01', '2026-11-30', '2026-12-01');

    expect(result.report.recordCounts).toMatchObject({ A000: 1, A100: 1, C100: 2, D110: 2, Z900: 1 });
    expect(result.report.totalRecords).toBe(7);
    const nonEmptyLines = result.bkmvdata.split('\r\n').filter(Boolean);
    expect(nonEmptyLines).toHaveLength(7);
    expect(nonEmptyLines[0]!.startsWith('A000')).toBe(true);
    expect(nonEmptyLines.at(-1)!.startsWith('Z900')).toBe(true);
  });

  it('excludes quotes and payment requests: not bookkeeping records', async () => {
    const client = await makeClient('Gamma Inc');
    await finalizeSale('QT', 100000, { clientId: client, date: '2026-11-07' });
    await finalizeSale('PR', 100000, { clientId: client, date: '2026-11-07' });

    const result = await buildUnifiedFile(testEnv(), '2026-11-07', '2026-11-07', '2026-12-01');
    expect(result.report.recordCounts.C100 ?? 0).toBe(0);
  });

  it('excludes a document outside the requested period', async () => {
    const series = await makeFreshBookkeepingSeries();
    const client = await makeClient('Delta LLC');
    await finalizeSale(series, 70000, { clientId: client, date: '2020-01-15' });

    // A window that does not overlap any other test's November dates in this file.
    const result = await buildUnifiedFile(testEnv(), '2026-12-01', '2026-12-31', '2027-01-01');
    expect(result.report.recordCounts.C100 ?? 0).toBe(0);
  });

  it('carries the 9-digit allocation number in C100 once the ITA has approved one', async () => {
    const client = await makeClient('Beta Co', CLIENT_VAT);
    const docId = await finalizeSale('400', 200000, { clientId: client, date: '2026-11-10' });
    await run(
      db(),
      `INSERT INTO ita_allocations (document_id, invoice_id, environment, status, confirmation_number, short_number)
       VALUES (?, ?, 'sandbox', 'approved', ?, ?)`,
      docId,
      crypto.randomUUID(),
      'SANDBOX-0000-123456789',
      '123456789',
    );

    const result = await buildUnifiedFile(testEnv(), '2026-11-10', '2026-11-10', '2026-12-01');
    expect(result.bkmvdata).toContain('123456789');
  });

  it('flags every document type whose spec code is not confirmed, since the spec PDF is missing', async () => {
    const client = await makeClient('Zeta Co');
    await finalizeSale('400', 40000, { clientId: client, date: '2026-11-12' });

    const result = await buildUnifiedFile(testEnv(), '2026-11-12', '2026-11-12', '2026-12-01');
    expect(result.report.warnings.some((w) => w.includes('not confirmed') && w.includes('400'))).toBe(true);
    expect(result.report.layoutStatus).toBe('stub');
  });

  it('reports the first and last number finalized per series in the period', async () => {
    const client = await makeClient('Eta Co');
    await finalizeSale('405', 10000, { clientId: client, date: '2026-11-15' });
    await finalizeSale('405', 20000, { clientId: client, date: '2026-11-16' });

    const result = await buildUnifiedFile(testEnv(), '2026-11-15', '2026-11-16', '2026-12-01');
    const series = result.report.series.find((s) => s.seriesId === '405');
    expect(series).toBeDefined();
    expect(series!.count).toBe(2);
    expect(series!.lastNumber).toBe(series!.firstNumber + 1);
  });

  it('zips OPENFRMT/INI.TXT and OPENFRMT/BKMVDATA.TXT, Windows-1255 encoded, round-tripping to the source text', async () => {
    const client = await makeClient('Theta Co');
    await finalizeSale('400', 30000, { clientId: client, date: '2026-11-20' });

    const result = await buildUnifiedFile(testEnv(), '2026-11-20', '2026-11-20', '2026-12-01');
    const entries = unzipSync(result.zip);
    expect(Object.keys(entries).sort()).toEqual(['OPENFRMT/BKMVDATA.TXT', 'OPENFRMT/INI.TXT']);
    expect(decodeWindows1255(entries['OPENFRMT/BKMVDATA.TXT']!)).toBe(result.bkmvdata);
    expect(decodeWindows1255(entries['OPENFRMT/INI.TXT']!)).toBe(result.iniText);
  });

  it('warns when no ITA business VAT number is configured and uses a placeholder', async () => {
    // The test worker binds no OWNER_TAX_ID / ITA_VAT_NUMBER secret (vitest.config.ts), so this
    // is the default path, not an override.
    const result = await buildUnifiedFile(testEnv(), '2026-11-01', '2026-11-01', '2026-12-01');
    expect(result.report.warnings.some((w) => w.includes('ITA business VAT number'))).toBe(true);
  });
});
