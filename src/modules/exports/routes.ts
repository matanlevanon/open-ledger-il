import { type Context, Hono } from 'hono';
import { businessIdOf } from '../../core/business';
import { audit } from '../../core/audit';
import { requireFeature } from '../../core/auth';
import { all, assertDate, first, run, todayIsrael } from '../../core/db';
import { ValidationError } from '../../core/errors';
import type { AppEnv } from '../../env';
import { buildPcn874 } from './pcn874/build';
import type { ValidationReport } from './types';
import { type UnifiedFileResult, buildUnifiedFile, businessIdentity } from './unified-file/build';
import { TransmitError, UnifiedFileUploader, sandboxPdf } from './unified-file/transmit';
import { isDemo } from '../demo/config';
import { type ItaEnv, itaManualMode } from '../ita/config';
import { buyerVatNumber } from '../ita/buyer';
import { ItaReconnectError, ItaUnavailableError } from '../ita/errors';
import { ItaTokenStore } from '../ita/tokens';

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
    `INSERT INTO export_runs (kind, period_from, period_to, record_count, total_ils_minor, series_summary, warnings, layout_status, generated_by, business_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    kind,
    report.from,
    report.to,
    report.totalRecords,
    report.totalIlsMinor,
    JSON.stringify(report.series),
    JSON.stringify(report.warnings),
    report.layoutStatus,
    c.get('user').id,
    businessIdOf(c),
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
    const result = await buildUnifiedFile(c.env, from, to, { drive: drive(c), businessId: businessIdOf(c) });
    await logRun(c, 'unified_file', result.report, { mainId: result.summary.mainId, path: result.summary.path });
    return download(result.zip, zipName(result), 'application/zip');
  });

  /**
   * One export for the Unified file screen: the zip (base64) plus the section 5.4 summary and
   * the section 2.6 report of the same run, so the screen shows exactly what went into the file.
   */
  r.post('/unified-file/run', requireFeature('unified_file'), async (c) => {
    const { from, to } = dateRange(c);
    const result = await buildUnifiedFile(c.env, from, to, { drive: drive(c), businessId: businessIdOf(c) });
    await logRun(c, 'unified_file', result.report, { mainId: result.summary.mainId, path: result.summary.path });
    return c.json({ filename: zipName(result), zipBase64: base64(result.zip), summary: result.summary, report: result.report });
  });

  /** The business the export dialog shows before a run. */
  r.get('/unified-file/business', requireFeature('unified_file'), async (c) => c.json(await businessIdentity(c.env, businessIdOf(c))));

  /** The section 2.6 report and the counts for a period, without logging an export. */
  r.get('/unified-file/report', requireFeature('unified_file'), async (c) => {
    const { from, to } = dateRange(c);
    const result = await buildUnifiedFile(c.env, from, to, { drive: drive(c), businessId: businessIdOf(c) });
    return c.json({ ...result.report, summary: result.summary });
  });

  // R47: send the unified file to the Tax Authority (תוספת 1, 3.2026, required from 1.1.2027).
  // Owner only, like every Tax Authority call ('ita' feature). The sandbox takes only a small PDF,
  // so a sandbox send uploads a test PDF in place of the two files and says so.
  const io = { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init), now: () => new Date() };

  const transmitError = (c: Context<AppEnv>, err: unknown) => {
    if (err instanceof ItaReconnectError) return c.json({ error: 'reconnect', message: 'Connect to the Tax Authority again in Settings, then send.' }, 409);
    if (err instanceof ItaUnavailableError) return c.json({ error: 'unavailable', message: err.message }, 503);
    if (err instanceof TransmitError) return c.json({ error: 'refused', message: err.message, code: err.code }, 422);
    throw err;
  };

  r.post('/unified-file/transmit', requireFeature('ita'), async (c) => {
    const env = c.env as ItaEnv;
    if (isDemo(env)) return c.json({ error: 'demo', message: 'The demo does not send files to the Tax Authority.' }, 409);
    if (itaManualMode(env)) return c.json({ error: 'manual', message: 'This Ledger has no Tax Authority connection. Set one up in Settings first.' }, 409);
    const { from, to } = dateRange(c);
    const businessId = businessIdOf(c);
    const tokens = new ItaTokenStore(env, io, businessId);
    const caseNumber = await buyerVatNumber(env, businessId);
    const result = await buildUnifiedFile(c.env, from, to, { drive: drive(c), businessId });
    await logRun(c, 'unified_file', result.report, { mainId: result.summary.mainId, path: result.summary.path, transmit: true });
    const test = tokens.environment === 'sandbox';
    const ini = test ? sandboxPdf(`INI ${from} ${to}`) : result.iniBytes;
    const bkm = test ? sandboxPdf(`BKMVDATA ${from} ${to}`) : result.bkmvBytes;
    const { lastRowId } = await run(
      c.env.DB,
      `INSERT INTO unified_file_transmissions (business_id, environment, period_from, period_to, case_number, ini_bytes, bkm_bytes, test_upload, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      businessId,
      tokens.environment,
      from,
      to,
      caseNumber,
      result.iniBytes.length,
      result.bkmvBytes.length,
      test ? 1 : 0,
      c.get('user').id,
    );
    try {
      const sent = await new UnifiedFileUploader(env, tokens, io).send({ caseNumber, from, to, ini, bkm });
      const [iniFile, bkmFile] = sent.files;
      await run(
        c.env.DB,
        "UPDATE unified_file_transmissions SET unique_id = ?, ini_file_id = ?, bkm_file_id = ?, ini_status = 'Uploaded', bkm_status = 'Uploaded' WHERE id = ?",
        sent.uniqueId,
        iniFile!.fileUniqueId,
        bkmFile!.fileUniqueId,
        lastRowId,
      );
      await audit(c, 'exports.unified_file.transmit', 'unified_file_transmission', String(lastRowId), { from, to, environment: tokens.environment, test });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The send failed.';
      await run(c.env.DB, "UPDATE unified_file_transmissions SET error = ?, ini_status = 'Failed', bkm_status = 'Failed' WHERE id = ?", message, lastRowId);
      return transmitError(c, err);
    }
    return c.json({ transmission: await first(c.env.DB, 'SELECT * FROM unified_file_transmissions WHERE id = ?', lastRowId) });
  });

  r.get('/unified-file/transmissions', requireFeature('unified_file'), async (c) =>
    c.json({ transmissions: await all(c.env.DB, 'SELECT * FROM unified_file_transmissions WHERE business_id = ? ORDER BY id DESC LIMIT 20', businessIdOf(c)) }),
  );

  r.post('/unified-file/transmissions/:id/check', requireFeature('ita'), async (c) => {
    const env = c.env as ItaEnv;
    const row = await first<{ id: number; ini_file_id: string | null; bkm_file_id: string | null; environment: string }>(
      c.env.DB,
      'SELECT id, ini_file_id, bkm_file_id, environment FROM unified_file_transmissions WHERE id = ? AND business_id = ?',
      Number(c.req.param('id')),
      businessIdOf(c),
    );
    if (!row) return c.json({ error: 'not_found', message: 'No such send.' }, 404);
    if (!row.ini_file_id || !row.bkm_file_id) return c.json({ error: 'not_sent', message: 'This send did not reach the Tax Authority.' }, 409);
    const tokens = new ItaTokenStore(env, io, businessIdOf(c));
    if (tokens.environment !== row.environment) return c.json({ error: 'environment', message: `This send went to the ${row.environment} environment.` }, 409);
    try {
      const items = await new UnifiedFileUploader(env, tokens, io).status([row.ini_file_id, row.bkm_file_id]);
      const of = (id: string) => items.find((i) => i.fileUniqueId === id);
      const label = (s: ReturnType<typeof of>) => (!s ? null : s.found ? s.status || null : s.error ? `Not found: ${s.error}` : 'Not found');
      const ini = of(row.ini_file_id);
      const bkm = of(row.bkm_file_id);
      const description = [ini?.description, bkm?.description].filter((d) => d && d.trim()).join(' · ') || null;
      await run(
        c.env.DB,
        "UPDATE unified_file_transmissions SET ini_status = COALESCE(?, ini_status), bkm_status = COALESCE(?, bkm_status), status_description = ?, checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
        label(ini),
        label(bkm),
        description,
        row.id,
      );
    } catch (err) {
      return transmitError(c, err);
    }
    return c.json({ transmission: await first(c.env.DB, 'SELECT * FROM unified_file_transmissions WHERE id = ?', row.id) });
  });

  r.get('/pcn874', requireFeature('pcn874'), async (c) => {
    const { from, to } = dateRange(c);
    const result = await buildPcn874(c.env, from, to, businessIdOf(c));
    await logRun(c, 'pcn874', result.report);
    return download(result.text, `pcn874-${from}-to-${to}.txt`, 'text/plain');
  });

  r.get('/pcn874/report', requireFeature('pcn874'), async (c) => {
    const { from, to } = dateRange(c);
    const result = await buildPcn874(c.env, from, to, businessIdOf(c));
    return c.json(result.report);
  });

  r.get('/runs', requireFeature('unified_file'), async (c) => {
    const rows = await c.env.DB.prepare('SELECT * FROM export_runs WHERE business_id = ? ORDER BY generated_at DESC LIMIT 50').bind(businessIdOf(c)).all();
    return c.json({ runs: rows.results });
  });

  return r;
}
