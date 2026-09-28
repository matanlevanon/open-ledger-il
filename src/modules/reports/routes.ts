import { type Context, Hono } from 'hono';
import { requireFeature, requireRole } from '../../core/auth';
import { assertDate, first, todayIsrael } from '../../core/db';
import { NotFoundError, ValidationError } from '../../core/errors';
import type { AppEnv } from '../../env';
import { signDownloadUrl } from '../access/downloads';
import { advanceBaseReport } from './advance-base';
import { REPORT_IDS, reportCsv, reportXlsx, runReport } from './catalog';
import { clientLedgersReport } from './client-ledgers';
import { buildDocumentsZip } from './documents-zip';
import { advanceBaseCsv, clientLedgersCsv, clientLedgersSheet, expenseCsv, expenseXlsx, incomeCsv, incomeXlsx, profitLossCsv, profitLossSheet } from './exporters';
import { expenseReport } from './expenses';
import { incomeReport } from './income';
import { buildXlsx } from './xlsx';
import { buildAccountantPack } from './pack';
import { profitLossReport } from './profit-loss';

function dateRange(c: Context<AppEnv>): { from: string; to: string } {
  const today = todayIsrael();
  const from = c.req.query('from') ?? `${today.slice(0, 4)}-01-01`;
  const to = c.req.query('to') ?? today;
  assertDate(from, 'from');
  assertDate(to, 'to');
  if (from > to) throw new ValidationError('"from" must not be after "to".');
  return { from, to };
}

function download(c: Context<AppEnv>, body: string | Uint8Array, filename: string, contentType: string) {
  return new Response(body, {
    headers: { 'content-type': contentType, 'content-disposition': `attachment; filename="${filename}"` },
  });
}

interface AccountantPackRow {
  id: number;
  period: string;
  pdf_key: string;
  xlsx_key: string;
  zip_key: string;
  expense_file_count: number;
  income_total_ils_minor: number;
  expense_total_ils_minor: number;
  generated_at: string;
  emailed_at: string | null;
  email_error: string | null;
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Filters a catalog report may read. Anything else in the query string is ignored. */
const REPORT_FILTERS = ['clientId', 'clientName', 'type', 'status', 'bucket', 'supplierId', 'categoryId', 'fixed', 'service', 'method'];

function reportParams(c: Context<AppEnv>, today: string) {
  const { from, to } = dateRange(c);
  const filters: Record<string, string> = {};
  for (const key of REPORT_FILTERS) {
    const v = c.req.query(key);
    if (v !== undefined && v !== '') filters[key] = v;
  }
  return { from, to, today, filters };
}

function reportId(c: Context<AppEnv>): string {
  const id = c.req.param('id') ?? '';
  if (!REPORT_IDS.includes(id)) throw new NotFoundError('Report', id);
  return id;
}

const PACK_FILES = { pdf: 'pdf_key', xlsx: 'xlsx_key', zip: 'zip_key' } as const;
type PackFile = keyof typeof PACK_FILES;

/** Routes under /api/reports. Reads need `reports` (both roles, per docs/accountant-access.md). */
export function reportsRoutes(options: { today?: () => string } = {}): Hono<AppEnv> {
  const today = options.today ?? (() => todayIsrael());
  const r = new Hono<AppEnv>();
  r.use('*', requireFeature('reports'));

  r.get('/income', async (c) => {
    const { from, to } = dateRange(c);
    return c.json(await incomeReport(c.env.DB, from, to));
  });
  r.get('/income.csv', async (c) => {
    const { from, to } = dateRange(c);
    return download(c, incomeCsv(await incomeReport(c.env.DB, from, to)), `income-${from}-to-${to}.csv`, 'text/csv');
  });
  r.get('/income.xlsx', async (c) => {
    const { from, to } = dateRange(c);
    return download(
      c,
      incomeXlsx(await incomeReport(c.env.DB, from, to)),
      `income-${from}-to-${to}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  r.get('/expenses', async (c) => {
    const { from, to } = dateRange(c);
    return c.json(await expenseReport(c.env.DB, from, to));
  });
  r.get('/expenses.csv', async (c) => {
    const { from, to } = dateRange(c);
    return download(c, expenseCsv(await expenseReport(c.env.DB, from, to)), `expenses-${from}-to-${to}.csv`, 'text/csv');
  });
  r.get('/expenses.xlsx', async (c) => {
    const { from, to } = dateRange(c);
    return download(
      c,
      expenseXlsx(await expenseReport(c.env.DB, from, to)),
      `expenses-${from}-to-${to}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  r.get('/profit-loss', async (c) => {
    const { from, to } = dateRange(c);
    return c.json(await profitLossReport(c.env.DB, from, to));
  });
  r.get('/profit-loss.csv', async (c) => {
    const { from, to } = dateRange(c);
    return download(c, profitLossCsv(await profitLossReport(c.env.DB, from, to)), `profit-loss-${from}-to-${to}.csv`, 'text/csv');
  });

  r.get('/profit-loss.xlsx', async (c) => {
    const { from, to } = dateRange(c);
    return download(c, buildXlsx([profitLossSheet(await profitLossReport(c.env.DB, from, to))]), `profit-loss-${from}-to-${to}.xlsx`, XLSX_TYPE);
  });

  // R21 report catalog: one shape for every report, JSON plus CSV and XLSX exports.
  r.get('/r/:id', async (c) => c.json(await runReport(c.env.DB, reportId(c), reportParams(c, today()))));
  r.get('/r/:id/csv', async (c) => {
    const id = reportId(c);
    const result = await runReport(c.env.DB, id, reportParams(c, today()));
    return download(c, reportCsv(result), `${id}-${result.from}-to-${result.to}.csv`, 'text/csv');
  });
  r.get('/r/:id/xlsx', async (c) => {
    const id = reportId(c);
    const result = await runReport(c.env.DB, id, reportParams(c, today()));
    return download(c, reportXlsx(result), `${id}-${result.from}-to-${result.to}.xlsx`, XLSX_TYPE);
  });

  // Download documents for a period: filed PDFs are income documents, so this also needs that feature.
  r.get('/documents.zip', requireFeature('income_documents'), async (c) => {
    const { from, to } = dateRange(c);
    const zip = await buildDocumentsZip(c.env, from, to);
    return download(c, zip.bytes, `documents-${from}-to-${to}.zip`, 'application/zip');
  });

  r.get('/advance-base', async (c) => {
    const { from, to } = dateRange(c);
    return c.json(await advanceBaseReport(c.env.DB, from, to));
  });
  r.get('/advance-base.csv', async (c) => {
    const { from, to } = dateRange(c);
    return download(c, advanceBaseCsv(await advanceBaseReport(c.env.DB, from, to)), `advance-base-${from}-to-${to}.csv`, 'text/csv');
  });

  // Client ledgers (תוספת ה׳, R16 task 11): every document and payment per client, running
  // balance in ILS and in the document currency. Same `reports` feature gate as every other
  // report in this module (module-wide r.use('*', ...) above); every accountant request is
  // already audited by authenticate() (CLAUDE.md rule 6), the same as the rest of this module.
  r.get('/client-ledgers', async (c) => {
    const { from, to } = dateRange(c);
    return c.json(await clientLedgersReport(c.env.DB, from, to));
  });
  r.get('/client-ledgers.csv', async (c) => {
    const { from, to } = dateRange(c);
    return download(c, clientLedgersCsv(await clientLedgersReport(c.env.DB, from, to)), `client-ledgers-${from}-to-${to}.csv`, 'text/csv');
  });
  r.get('/client-ledgers.xlsx', async (c) => {
    const { from, to } = dateRange(c);
    return download(
      c,
      buildXlsx([clientLedgersSheet(await clientLedgersReport(c.env.DB, from, to))]),
      `client-ledgers-${from}-to-${to}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  r.get('/packs', requireFeature('monthly_pack'), async (c) => {
    const rows = await c.env.DB.prepare('SELECT * FROM accountant_packs ORDER BY period DESC').all<AccountantPackRow>();
    return c.json({ packs: rows.results });
  });

  // Generating a pack on demand is an owner action: an accountant only ever downloads one
  // (docs/accountant-access.md, "Monthly pack" is a "can: download" row, not "can: generate").
  r.post('/packs/run', requireRole('owner'), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { period?: string };
    const period = body.period ?? todayIsrael().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(period)) throw new ValidationError('period must be YYYY-MM.');
    const result = await buildAccountantPack(c.env, period);
    return c.json({ pack: result }, 201);
  });

  r.get('/packs/:id/download/:file', requireFeature('monthly_pack'), async (c) => {
    const id = Number(c.req.param('id'));
    const file = c.req.param('file') as PackFile;
    if (!(file in PACK_FILES)) throw new ValidationError('file must be pdf, xlsx or zip.');
    const pack = await first<AccountantPackRow>(c.env.DB, 'SELECT * FROM accountant_packs WHERE id = ?', id);
    if (!pack) throw new NotFoundError('Accountant pack', id);
    const key = pack[PACK_FILES[file]];
    const { path } = await signDownloadUrl(c.env, key, 'monthly_pack');
    return c.json({ path });
  });

  return r;
}
