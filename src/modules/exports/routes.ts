import { type Context, Hono } from 'hono';
import { audit } from '../../core/audit';
import { requireFeature } from '../../core/auth';
import { assertDate, run, todayIsrael } from '../../core/db';
import { ValidationError } from '../../core/errors';
import type { AppEnv } from '../../env';
import { buildPcn874 } from './pcn874/build';
import type { ValidationReport } from './types';
import { type UnifiedFileResult, buildUnifiedFile, businessIdentity } from './unified-file/build';

function dateRange(c: Context<AppEnv>): { from: string; to: string } {
  const today = todayIsrael();
  const from = c.req.query('from') ?? `${today.slice(0, 4)}-01-01`;
  const to = c.req.query('to') ?? today;
  assertDate(from, 'from');
  assertDate(to, 'to');
  if (from > to) throw new ValidationError('"from" must not be after "to".');
  return { from, to };
}

/** Drive letter for field 1012 and the 5.4 screen (section 2.2). */
function drive(c: Context<AppEnv>): string {
  const d = (c.req.query('drive') ?? 'C').toUpperCase();
  if (!/^[A-Z]$/.test(d)) throw new ValidationError('"drive" must be one letter, A to Z.');
  return d;
}

function download(body: string | Uint8Array, filename: string, contentType: string): Response {
  return new Response(body, {
    headers: { 'content-type': contentType, 'content-disposition': `attachment; filename="${filename}"` },
  });
}

function zipName(result: UnifiedFileResult): string {
  const parts = result.summary.path.split('\\');
  return `OPENFRMT-${parts.at(-2)}-${parts.at(-1)}.zip`;
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function logRun(c: Context<AppEnv>, kind: 'unified_file' | 'pcn874', report: ValidationReport, extra: Record<string, unknown> = {}): Promise<void> {
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
    ...extra,
  });
}

/** Routes under /api/exports. Both features default "on" for the accountant (docs/accountant-access.md). */
export function exportsRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  /** The unified file as a zip download: OPENFRMT/<vat>.<yy>/<MMDDhhmm>/INI.TXT and BKMVDATA.zip. */
  r.get('/unified-file', requireFeature('unified_file'), async (c) => {
    const { from, to } = dateRange(c);
    const result = await buildUnifiedFile(c.env, from, to, { drive: drive(c) });
    await logRun(c, 'unified_file', result.report, { mainId: result.summary.mainId, path: result.summary.path });
    return download(result.zip, zipName(result), 'application/zip');
  });

  /**
   * One export for the Unified file screen: the zip (base64) plus the section 5.4 summary and
   * the section 2.6 report of the same run, so the screen shows exactly what went into the file.
   */
  r.post('/unified-file/run', requireFeature('unified_file'), async (c) => {
    const { from, to } = dateRange(c);
    const result = await buildUnifiedFile(c.env, from, to, { drive: drive(c) });
    await logRun(c, 'unified_file', result.report, { mainId: result.summary.mainId, path: result.summary.path });
    return c.json({ filename: zipName(result), zipBase64: base64(result.zip), summary: result.summary, report: result.report });
  });

  /** The business the export dialog shows before a run. */
  r.get('/unified-file/business', requireFeature('unified_file'), async (c) => c.json(await businessIdentity(c.env)));

  /** The section 2.6 report and the counts for a period, without logging an export. */
  r.get('/unified-file/report', requireFeature('unified_file'), async (c) => {
    const { from, to } = dateRange(c);
    const result = await buildUnifiedFile(c.env, from, to, { drive: drive(c) });
    return c.json({ ...result.report, summary: result.summary });
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
