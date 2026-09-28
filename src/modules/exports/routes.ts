import { type Context, Hono } from 'hono';
import { audit } from '../../core/audit';
import { requireFeature } from '../../core/auth';
import { assertDate, run, todayIsrael } from '../../core/db';
import { ValidationError } from '../../core/errors';
import type { AppEnv } from '../../env';
import { buildPcn874 } from './pcn874/build';
import type { ValidationReport } from './types';
import { buildUnifiedFile } from './unified-file/build';

function dateRange(c: Context<AppEnv>): { from: string; to: string } {
  const today = todayIsrael();
  const from = c.req.query('from') ?? `${today.slice(0, 4)}-01-01`;
  const to = c.req.query('to') ?? today;
  assertDate(from, 'from');
  assertDate(to, 'to');
  if (from > to) throw new ValidationError('"from" must not be after "to".');
  return { from, to };
}

function download(body: string | Uint8Array, filename: string, contentType: string): Response {
  return new Response(body, {
    headers: { 'content-type': contentType, 'content-disposition': `attachment; filename="${filename}"` },
  });
}

async function logRun(c: Context<AppEnv>, kind: 'unified_file' | 'pcn874', report: ValidationReport): Promise<void> {
  await run(
    c.env.DB,
    `INSERT INTO export_runs (kind, period_from, period_to, record_count, total_ils_minor, series_summary, warnings, layout_status, generated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    kind,
    report.from,
    report.to,
    report.totalRecords,
    report.totalIlsMinor,
    JSON.stringify(report.series),
    JSON.stringify(report.warnings),
    report.layoutStatus,
    c.get('user').id,
  );
  await audit(c, `exports.${kind}.generate`, 'export_run', `${report.from}:${report.to}`, {
    recordCount: report.totalRecords,
    warnings: report.warnings,
  });
}

/** Routes under /api/exports. Both features default "on" for the accountant (docs/accountant-access.md). */
export function exportsRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/unified-file', requireFeature('unified_file'), async (c) => {
    const { from, to } = dateRange(c);
    const result = await buildUnifiedFile(c.env, from, to, todayIsrael());
    await logRun(c, 'unified_file', result.report);
    return download(result.zip, `unified-file-${from}-to-${to}.zip`, 'application/zip');
  });

  r.get('/unified-file/report', requireFeature('unified_file'), async (c) => {
    const { from, to } = dateRange(c);
    const result = await buildUnifiedFile(c.env, from, to, todayIsrael());
    return c.json(result.report);
  });

  r.get('/pcn874', requireFeature('pcn874'), async (c) => {
    const { from, to } = dateRange(c);
    const result = await buildPcn874(c.env, from, to);
    await logRun(c, 'pcn874', result.report);
    return download(result.text, `pcn874-${from}-to-${to}.txt`, 'text/plain');
  });

  r.get('/pcn874/report', requireFeature('pcn874'), async (c) => {
    const { from, to } = dateRange(c);
    const result = await buildPcn874(c.env, from, to);
    return c.json(result.report);
  });

  r.get('/runs', requireFeature('unified_file'), async (c) => {
    const rows = await c.env.DB.prepare('SELECT * FROM export_runs ORDER BY generated_at DESC LIMIT 50').all();
    return c.json({ runs: rows.results });
  });

  return r;
}
