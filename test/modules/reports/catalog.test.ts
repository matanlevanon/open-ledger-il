import { env } from 'cloudflare:workers';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { finalizeDocument } from '../../../src/core/numbering';
import { createApp } from '../../../src/index';
import { createDashboardModule } from '../../../src/modules/dashboard';
import { createReportsModule } from '../../../src/modules/reports';
import { REPORT_IDS, type ReportResult, reportCsv } from '../../../src/modules/reports/catalog';
import { r2Key } from '../../../src/modules/pdf/store';
import { OWNER_ACTOR, db, makeDraft } from '../../helpers';

const TODAY = '2026-10-06';
const app = createApp({ modules: [createReportsModule({ today: () => TODAY }), createDashboardModule({ today: () => TODAY })] });

async function get(path: string, init: RequestInit = {}, as?: string) {
  return app.request(`/api${path}`, init, { ...env, ...(as ? { DEV_AUTH_EMAIL: as } : {}) });
}

async function json<T>(path: string): Promise<T> {
  const res = await get(path);
  expect(res.status, path).toBe(200);
  return (await res.json()) as T;
}

describe('R21 report catalog', () => {
  it('answers every report with columns, rows and totals', async () => {
    const id = await makeDraft({ seriesId: '400', totalMinor: 42000, payments: [{ amountMinor: 42000, paidOn: '2026-10-01' }] });
    await finalizeDocument(db(), id, { actor: OWNER_ACTOR });
    for (const report of REPORT_IDS) {
      const body = await json<ReportResult>(`/reports/r/${report}?from=2026-01-01&to=2026-12-31`);
      expect(body.report).toBe(report);
      expect(body.columns.length).toBeGreaterThan(0);
      expect(Array.isArray(body.rows)).toBe(true);
    }
  });

  it('drills from a month of cash flow to the documents behind it', async () => {
    const body = await json<ReportResult>('/reports/r/cash-flow?from=2026-10-01&to=2026-10-31');
    expect(body.rows[0]?.link).toEqual({ kind: 'report', report: 'all-documents', params: { from: '2026-10-01', to: '2026-10-31' } });
    const docs = await json<ReportResult>('/reports/r/all-documents?from=2026-10-01&to=2026-10-31&type=400');
    expect(docs.rows.every((r) => r.link?.kind === 'document')).toBe(true);
    expect(docs.rows.every((r) => r.cells.type === 'Receipt')).toBe(true);
  });

  it('filters open requests by aging bucket', async () => {
    const pr = await makeDraft({ seriesId: 'PR', totalMinor: 15000 });
    await run(db(), `UPDATE documents SET due_date = '2026-08-01' WHERE id = ?`, pr);
    await finalizeDocument(db(), pr, { actor: OWNER_ACTOR });
    const body = await json<ReportResult>('/reports/r/aged-receivables?from=2026-01-01&to=2026-12-31&bucket=61-90');
    const row = body.rows.find((r) => r.key === String(pr))!;
    expect(row.cells).toMatchObject({ bucket: '61-90', daysLate: 66, openIls: 15000 });
    const other = await json<ReportResult>('/reports/r/aged-receivables?from=2026-01-01&to=2026-12-31&bucket=90%2B');
    expect(other.rows.some((r) => r.key === String(pr))).toBe(false);
  });

  it('refuses an unknown report and a bad filter', async () => {
    expect((await get('/reports/r/nope?from=2026-01-01&to=2026-12-31')).status).toBe(404);
    expect((await get('/reports/r/aged-receivables?from=2026-01-01&to=2026-12-31&bucket=soon')).status).toBe(400);
  });

  it('exports CSV with a totals row and money split into currency and amount', () => {
    const csv = reportCsv({
      report: 'x',
      title: 'X',
      from: '2026-01-01',
      to: '2026-12-31',
      columns: [
        { key: 'client', header: 'Client', kind: 'text' },
        { key: 'amount', header: 'Amount', kind: 'money' },
        { key: 'ils', header: 'Amount ILS', kind: 'ils', total: true },
      ],
      rows: [{ key: 'a', cells: { client: 'Acme, Ltd', amount: { minor: 12345, currency: 'USD' }, ils: 45678 } }],
      totals: { ils: 45678 },
    });
    expect(csv).toBe('Client,Amount currency,Amount,Amount ILS\r\n"Acme, Ltd",USD,123.45,456.78\r\nTotal,,,456.78\r\n');
  });

  it('downloads a report as CSV and XLSX', async () => {
    const csv = await get('/reports/r/expenses-by-category/csv?from=2026-01-01&to=2026-12-31');
    expect(csv.headers.get('content-disposition')).toContain('expenses-by-category-2026-01-01-to-2026-12-31.csv');
    expect((await csv.text()).split('\r\n')[0]).toBe('Category,Expenses,"Amount, original currency",Amount ILS');
    const xlsx = await get('/reports/r/cash-flow/xlsx?from=2026-01-01&to=2026-12-31');
    const files = unzipSync(new Uint8Array(await xlsx.arrayBuffer()));
    expect(Object.keys(files)).toContain('xl/worksheets/sheet1.xml');
    const pl = await get('/reports/profit-loss.xlsx?from=2026-01-01&to=2026-12-31');
    expect(pl.status).toBe(200);
  });

  it('zips the stored filed PDFs for a period and lists what it left out', async () => {
    const id = await makeDraft({ seriesId: '400', totalMinor: 1000 });
    await finalizeDocument(db(), id, { actor: OWNER_ACTOR });
    const doc = await db().prepare('SELECT date, series_id, number FROM documents WHERE id = ?').bind(id).first<{ date: string; series_id: string; number: number }>();
    await env.FILES.put(r2Key(doc!.date, doc!.series_id, doc!.number, 'filed'), new Uint8Array([37, 80, 68, 70]));
    const res = await get('/reports/documents.zip?from=2026-10-01&to=2026-10-31');
    expect(res.headers.get('content-type')).toBe('application/zip');
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).some((n) => n.endsWith(`400-${String(doc!.number).padStart(4, '0')}.pdf`))).toBe(true);
    expect(new TextDecoder().decode(files['manifest.txt'])).toContain('no stored PDF yet');
  });
});

describe('R21 dashboard endpoint', () => {
  it('answers only the requested cards, each with its own period', async () => {
    const body = await json<{ cards: Record<string, { from?: string; months?: unknown[] }> }>(
      '/dashboard?cards=cashFlow,aging&cashFlow=2025-01-01..2026-12-31',
    );
    expect(Object.keys(body.cards).sort()).toEqual(['aging', 'cashFlow']);
    expect(body.cards.cashFlow?.months).toHaveLength(24);
  });

  it('refuses an unknown card and a bad range', async () => {
    expect((await get('/dashboard?cards=nope')).status).toBe(400);
    expect((await get('/dashboard?cards=cashFlow&cashFlow=2026-12-01..2026-01-01')).status).toBe(400);
  });

  it('stores the layout, and the dashboard then loads only the visible cards', async () => {
    const put = await get('/dashboard/layout', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards: [{ id: 'aging', visible: true }, { id: 'cashFlow', visible: false }] }),
    });
    expect(put.status).toBe(200);
    const layout = (await put.json()) as { cards: { id: string; visible: boolean }[] };
    expect(layout.cards[0]).toEqual({ id: 'aging', visible: true });
    expect(layout.cards).toHaveLength(13);

    const body = await json<{ cards: Record<string, unknown>; layout: { id: string }[] }>('/dashboard');
    expect(body.layout[0]?.id).toBe('aging');
    expect(body.cards.cashFlow).toBeUndefined();
    expect(body.cards.aging).toBeDefined();

    const audit = await db().prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'dashboard.layout_set'").first<{ n: number }>();
    expect(audit!.n).toBeGreaterThan(0);
  });

  it('lets only the owner change the layout', async () => {
    const email = `cpa-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const acc = await run(db(), `INSERT INTO users (email, role) VALUES (?, 'accountant')`, email);
    await run(db(), `INSERT INTO user_features (user_id, feature, enabled) VALUES (?, 'reports', 1)`, acc.lastRowId);
    const res = await get(
      '/dashboard/layout',
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cards: [] }) },
      email,
    );
    expect(res.status).toBe(403);
    expect((await get('/dashboard/layout', {}, email)).status).toBe(200);
  });
});
