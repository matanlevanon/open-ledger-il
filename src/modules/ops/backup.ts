import { first, nowIso, run } from '../../core/db';
import { GENESIS_HASH, verifyChainFromTables } from '../../core/hashchain';
import type { Env } from '../../env';
import { getDriveRootFolder } from '../expenses/service';
import { type Notifier, slackNotifier } from '../ita/notify';
import { type DriveBackupUploader, GoogleDriveBackupUploader, quarterLabel } from './drive-backup';

/** Must match the R14 entry in wrangler.toml's `[triggers] crons`. First week of the quarter, per instruction 25(ו). */
/**
 * The quarterly backup rides on the nightly 02:00 UTC cron, so the Worker needs only 5 cron
 * triggers (Workers Free allows 5). It runs when that night is the 1st of Jan, Apr, Jul or Oct.
 */
export const BACKUP_CRON = '0 2 * * *';

/** True on the first day of a quarter, in UTC, the date the cron fires on. */
export function isQuarterStart(scheduledTime: number): boolean {
  const d = new Date(scheduledTime);
  return d.getUTCDate() === 1 && d.getUTCMonth() % 3 === 0;
}

/**
 * Bookkeeping tables backed up every quarter (docs/legal-requirements.md, instruction 25(ו)).
 * Always present once R00 and R01 are merged, which every R14 run requires.
 */
const CORE_TABLES = [
  'business_profile',
  'legal_modes',
  'vat_rates',
  'thresholds',
  'ceilings',
  'series',
  'clients',
  'client_consents',
  'client_contacts',
  'items',
  'documents',
  'document_lines',
  'payments',
  'payment_details',
  'document_links',
  'document_meta',
  'document_events',
  'finalizations',
  'fx_rates',
] as const;

/** Tables owned by later-merging runs. Exported only when present, so an early deploy still backs up. */
const OPTIONAL_TABLES = ['expenses', 'expense_files', 'suppliers', 'expense_categories', 'allocation_records'] as const;

export type BackupTables = Record<string, Record<string, unknown>[]>;

async function tableExists(db: D1Database, name: string): Promise<boolean> {
  const row = await first<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name);
  return row !== null;
}

async function exportTables(db: D1Database): Promise<BackupTables> {
  const out: BackupTables = {};
  for (const t of CORE_TABLES) out[t] = (await db.prepare(`SELECT * FROM ${t}`).all<Record<string, unknown>>()).results;
  for (const t of OPTIONAL_TABLES) out[t] = (await tableExists(db, t)) ? (await db.prepare(`SELECT * FROM ${t}`).all<Record<string, unknown>>()).results : [];
  return out;
}

export interface BackupManifest {
  ranAt: string;
  kind: 'quarterly' | 'manual';
  dataKey: string;
  tables: Record<string, number>;
  documentCount: number;
  chainHeadHash: string;
}

/**
 * The restore test: given the rows read back from an R2 backup object, rebuilds the hash chain
 * and every allocation_records hash entirely in memory, the same recomputation `verifyChain` runs
 * against a live database (src/core/hashchain.ts), and reports any mismatch. No scratch database,
 * no write of any kind: recomputing from the R2 object is the only "restore" this proves.
 */
export async function restoreAndVerify(tables: BackupTables, expectedHead: string): Promise<void> {
  const report = await verifyChainFromTables(tables);
  if (!report.ok) throw new Error(`Restored chain has ${report.breaks.length} break(s): ${JSON.stringify(report.breaks)}`);
  if (report.headHash !== expectedHead) {
    throw new Error(`Restored chain head ${report.headHash} does not match the export's ${expectedHead}.`);
  }
}

export interface BackupRunResult {
  dataKey: string;
  manifestKey: string;
  documentCount: number;
  chainHeadHash: string;
  restoreOk: boolean;
  restoreError: string | null;
  /** false when the off-site Drive copy was skipped or failed; never fails the backup itself. */
  driveUploaded: boolean;
}

export type RestoreCheck = (tables: BackupTables, expectedHead: string) => Promise<void>;

/**
 * Uploads the same export and manifest already in R2 to Google Drive, under "<root>/
 * Backups/YYYY-Qn" (R16 task 12). Never throws: a missing secret, a missing root folder, or any
 * Drive API failure logs a warning and sends a Slack alert (when SLACK_WEBHOOK_URL is set;
 * `notifier.send` itself no-ops otherwise), and the quarterly R2 backup this runs after is
 * already done and unaffected either way.
 */
async function uploadOffSiteCopy(
  env: Env,
  notifier: Notifier,
  uploader: DriveBackupUploader,
  at: string,
  dataKey: string,
  dataBytes: string,
  manifestKey: string,
  manifestBytes: string,
): Promise<boolean> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.warn('GOOGLE_SERVICE_ACCOUNT_JSON is not set. Skipping the off-site Google Drive backup copy.');
    await notifier.send(':warning: Open Ledger IL quarterly backup: GOOGLE_SERVICE_ACCOUNT_JSON is not set, so the off-site Google Drive copy was skipped. The R2 backup still ran.');
    return false;
  }
  const rootFolderId = await getDriveRootFolder(env.DB);
  if (!rootFolderId) {
    console.warn('The Drive root folder (Settings, Expenses) is not set. Skipping the off-site Google Drive backup copy.');
    await notifier.send(':warning: Open Ledger IL quarterly backup: the Drive root folder is not set, so the off-site Google Drive copy was skipped. The R2 backup still ran.');
    return false;
  }
  const path = ['Backups', quarterLabel(at)];
  try {
    await uploader.upload(rootFolderId, path, dataKey.split('/').pop()!, new TextEncoder().encode(dataBytes), 'application/json');
    await uploader.upload(rootFolderId, path, manifestKey.split('/').pop()!, new TextEncoder().encode(manifestBytes), 'application/json');
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Off-site Google Drive backup copy failed: ${message}`);
    await notifier.send(`:warning: Open Ledger IL quarterly backup: the off-site Google Drive copy failed: ${message}. The R2 backup still ran.`);
    return false;
  }
}

/** Exports the bookkeeping tables to R2, then reads that export back and recomputes the hash chain from it in memory to prove the object actually in R2 is restorable. */
export async function runBackup(
  env: Env,
  kind: 'quarterly' | 'manual',
  at: string = nowIso(),
  notifier?: Notifier,
  restore: RestoreCheck = restoreAndVerify,
  driveUploader?: DriveBackupUploader,
): Promise<BackupRunResult> {
  const n = notifier ?? slackNotifier(env.SLACK_WEBHOOK_URL, (input, init) => fetch(input, init));
  const tables = await exportTables(env.DB);

  const finalizations = tables.finalizations ?? [];
  const lastHash = finalizations.at(-1)?.hash;
  const chainHeadHash = typeof lastHash === 'string' ? lastHash : GENESIS_HASH;
  const documentCount = (tables.documents ?? []).length;

  const dateKey = at.slice(0, 10);
  const uid = crypto.randomUUID();
  const dataKey = `exports/${dateKey}/${uid}-data.json`;
  const manifestKey = `exports/${dateKey}/${uid}-manifest.json`;
  const manifest: BackupManifest = {
    ranAt: at,
    kind,
    dataKey,
    tables: Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length])),
    documentCount,
    chainHeadHash,
  };

  const dataJson = JSON.stringify(tables);
  const manifestJson = JSON.stringify(manifest);
  await env.BACKUPS.put(dataKey, dataJson);
  await env.BACKUPS.put(manifestKey, manifestJson);

  let restoreOk = true;
  let restoreError: string | null = null;
  try {
    const stored = await env.BACKUPS.get(dataKey);
    if (!stored) throw new Error(`Backup data object ${dataKey} was not found in R2 right after writing it.`);
    const restoredTables = JSON.parse(await stored.text()) as BackupTables;
    await restore(restoredTables, chainHeadHash);
  } catch (err) {
    restoreOk = false;
    restoreError = err instanceof Error ? err.message : String(err);
  }

  await run(
    env.DB,
    `INSERT INTO backups (kind, ran_at, d1_export_key, manifest_key, table_count, document_count, chain_head_hash, restore_ok, restore_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    kind,
    at,
    dataKey,
    manifestKey,
    Object.keys(tables).length,
    documentCount,
    chainHeadHash,
    restoreOk,
    restoreError,
  );

  if (!restoreOk) {
    await n.send(`:rotating_light: Open Ledger IL backup restore test failed (${kind}, ${at}): ${restoreError}`);
  }

  const driveUploaded = await uploadOffSiteCopy(env, n, driveUploader ?? new GoogleDriveBackupUploader(env), at, dataKey, dataJson, manifestKey, manifestJson);

  return { dataKey, manifestKey, documentCount, chainHeadHash, restoreOk, restoreError, driveUploaded };
}

export interface BackupDeps {
  notifier?: Notifier;
  restore?: RestoreCheck;
  driveUploader?: DriveBackupUploader;
}

export async function backupScheduled(controller: ScheduledController, env: Env, _ctx?: ExecutionContext, deps: BackupDeps = {}): Promise<void> {
  if (controller.cron !== BACKUP_CRON || !isQuarterStart(controller.scheduledTime)) return;
  await runBackup(env, 'quarterly', nowIso(), deps.notifier, deps.restore, deps.driveUploader);
}
