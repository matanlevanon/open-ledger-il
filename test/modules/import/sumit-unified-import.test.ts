import { strToU8, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { BKMVDATA_TEXT, INI_TEXT } from '../../fixtures/import/sumit-unified';
import { buildApp, call, env } from './helpers';

interface HistoryRow {
  id: number;
  source: string;
  source_kind: string;
  doc_type: string | null;
  raw_line: string | null;
  decoded: number;
  decode_note: string | null;
}
interface Summary {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: unknown[];
}

function buildZip(): ArrayBuffer {
  const zipped = zipSync({ 'INI.TXT': strToU8(INI_TEXT), 'BKMVDATA.TXT': strToU8(BKMVDATA_TEXT) });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

function zipForm(bytes: ArrayBuffer): FormData {
  const form = new FormData();
  form.append('file', new File([bytes], 'export.zip', { type: 'application/zip' }));
  return form;
}

async function sumitHistoryRows(): Promise<HistoryRow[]> {
  const { results } = await env.DB.prepare("SELECT * FROM history WHERE source = 'sumit' ORDER BY source_kind").all<HistoryRow>();
  return results;
}

describe('import: SUMIT unified-file ZIP', () => {
  beforeEach(async () => {
    await run(env.DB, 'DELETE FROM history');
    await run(env.DB, 'DELETE FROM import_batches');
  });

  it('previews record-type counts without writing anything', async () => {
    const app = buildApp();
    const res = await call(app, '/sumit/unified/preview', { method: 'POST', body: zipForm(buildZip()) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalLines: number; recordTypeCounts: Record<string, number>; note: string };
    expect(body.totalLines).toBe(4);
    expect(body.recordTypeCounts).toMatchObject({ C100: 1, D110: 1, D120: 1, A100: 1 });
    expect(body.note).toMatch(/not decoded/);
    expect(await sumitHistoryRows()).toHaveLength(0);
  });

  it('commits only the C100, D110 and D120 records into history, marked undecoded', async () => {
    const app = buildApp();
    const res = await call(app, '/sumit/unified/commit', { method: 'POST', body: zipForm(buildZip()) });
    expect(res.status).toBe(200);
    const { summary } = (await res.json()) as { summary: Summary };
    expect(summary).toMatchObject({ created: 3, skipped: 0 });

    const rows = await sumitHistoryRows();
    expect(rows.map((r) => r.doc_type).sort()).toEqual(['C100', 'D110', 'D120']);
    for (const row of rows) {
      expect(row.decoded).toBe(0);
      expect(row.decode_note).toMatch(/not decoded/);
      expect(row.raw_line).toBeTruthy();
    }
  });

  it('is idempotent: re-importing the same export never duplicates a history row', async () => {
    const app = buildApp();
    const zip = buildZip();
    await call(app, '/sumit/unified/commit', { method: 'POST', body: zipForm(zip) });
    const second = await call(app, '/sumit/unified/commit', { method: 'POST', body: zipForm(zip) });
    const { summary } = (await second.json()) as { summary: Summary };
    expect(summary).toMatchObject({ created: 0, skipped: 3 });
    expect(await sumitHistoryRows()).toHaveLength(3);
  });

  it('is read-only, like the Wave history rows: no route deletes a history row', async () => {
    const app = buildApp();
    await call(app, '/sumit/unified/commit', { method: 'POST', body: zipForm(buildZip()) });
    const [row] = await sumitHistoryRows();
    expect((await call(app, `/history/${row!.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('refuses a ZIP with no BKMVDATA.TXT', async () => {
    const badZip = zipSync({ 'INI.TXT': strToU8(INI_TEXT) });
    const app = buildApp();
    const res = await call(app, '/sumit/unified/preview', {
      method: 'POST',
      body: zipForm(badZip.buffer.slice(badZip.byteOffset, badZip.byteOffset + badZip.byteLength) as ArrayBuffer),
    });
    expect(res.status).toBe(400);
  });
});
