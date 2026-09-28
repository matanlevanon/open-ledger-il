import { beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { WAVE_INVOICES_CSV } from '../../fixtures/import/wave';
import { buildApp, bytesFrom, call, env, uploadForm } from './helpers';

interface HistoryRow {
  id: number;
  source: string;
  source_kind: string;
  external_id: string | null;
  client_id: number | null;
  client_name: string | null;
  currency: string | null;
  amount_minor: number | null;
  status: string | null;
}
interface Summary {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

async function historyRows(): Promise<HistoryRow[]> {
  const { results } = await env.DB.prepare("SELECT * FROM history WHERE source = 'wave' ORDER BY external_id").all<HistoryRow>();
  return results;
}

describe('import: Wave invoices CSV, into read-only history', () => {
  beforeEach(async () => {
    await run(env.DB, 'DELETE FROM history');
    await run(env.DB, 'DELETE FROM import_batches');
    await run(env.DB, 'DELETE FROM clients');
  });

  it('imports each row as a history row, converting the amount to minor units', async () => {
    const app = buildApp();
    const res = await call(app, '/wave/invoices/commit', {
      method: 'POST',
      body: uploadForm(bytesFrom(WAVE_INVOICES_CSV), 'invoices.csv', 'text/csv'),
    });
    expect(res.status).toBe(200);
    const { summary } = (await res.json()) as { summary: Summary };
    expect(summary).toMatchObject({ totalRows: 2, created: 2, skipped: 0 });

    const rows = await historyRows();
    expect(rows).toHaveLength(2);
    const invoice301 = rows.find((r) => r.external_id === '301')!;
    expect(invoice301).toMatchObject({ source_kind: 'wave_invoice', currency: 'EUR', amount_minor: 48000, status: 'Overdue' });
    const invoice302 = rows.find((r) => r.external_id === '302')!;
    expect(invoice302.amount_minor).toBe(125000); // "1,250.00"
  });

  it('links a row to an existing client by name, without requiring one', async () => {
    await run(env.DB, "INSERT INTO clients (name_en) VALUES ('Example Client Ltd')");
    const app = buildApp();
    await call(app, '/wave/invoices/commit', { method: 'POST', body: uploadForm(bytesFrom(WAVE_INVOICES_CSV), 'i.csv', 'text/csv') });
    const rows = await historyRows();
    const invoice301 = rows.find((r) => r.external_id === '301')!;
    expect(invoice301.client_id).not.toBeNull();
    const invoice302 = rows.find((r) => r.external_id === '302')!;
    expect(invoice302.client_id).toBeNull(); // "Northwind Traders, Inc." has no matching client
  });

  it('is idempotent: importing the same file twice never duplicates a history row', async () => {
    const app = buildApp();
    const body = () => uploadForm(bytesFrom(WAVE_INVOICES_CSV), 'i.csv', 'text/csv');
    await call(app, '/wave/invoices/commit', { method: 'POST', body: body() });
    const second = await call(app, '/wave/invoices/commit', { method: 'POST', body: body() });
    const { summary } = (await second.json()) as { summary: Summary };
    expect(summary).toMatchObject({ created: 0, skipped: 2 });
    expect(await historyRows()).toHaveLength(2);
  });

  it('is read-only: no route updates or deletes a history row', async () => {
    const app = buildApp();
    await call(app, '/wave/invoices/commit', { method: 'POST', body: uploadForm(bytesFrom(WAVE_INVOICES_CSV), 'i.csv', 'text/csv') });
    const [row] = await historyRows();
    expect((await call(app, `/history/${row!.id}`, { method: 'PATCH' })).status).toBe(404);
    expect((await call(app, `/history/${row!.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('skips a row with no invoice number and reports it', async () => {
    const csv = 'Invoice Number,Customer,Amount\n,No Number,10.00\n80,Has Number,20.00\n';
    const app = buildApp();
    const res = await call(app, '/wave/invoices/commit', { method: 'POST', body: uploadForm(bytesFrom(csv), 'i.csv', 'text/csv') });
    const { summary } = (await res.json()) as { summary: Summary };
    expect(summary).toMatchObject({ totalRows: 2, created: 1, skipped: 1 });
  });
});
