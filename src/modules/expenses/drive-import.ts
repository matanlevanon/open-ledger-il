import { type AuditActor, auditAs, auditStatement } from '../../core/audit';
import { all, first, nowIso, run, stmt, transaction } from '../../core/db';
import { ConfigError, ValidationError } from '../../core/errors';
import { type Currency, HOME_CURRENCY, assertCurrency, isCurrency, parseMajor } from '../../core/money';
import type { Env } from '../../env';
import { DEFAULT_INDEX_TITLE_PATTERN, type DriveFile, FOLDER_MIME, indexSheetTitle, monthFolderName } from './drive';
import { r2KeyFor, sha256Hex, storeFile } from './files';
import { convertToIls } from './fx';
import * as service from './service';
import type { Deps } from './service';
import type { ExpenseStatus, ExtractedExpense } from './types';

/**
 * R20: one month of expenses from Google Drive. The monthly index sheet is the source of truth
 * when it exists. Without it, every file in the month folder goes through AI extraction for
 * review. Both paths skip anything already in the ledger and never change an existing expense.
 */

const DAILY_SYNC_SETTING_KEY = 'expenses.drive_daily_sync';
const INDEX_TITLE_SETTING_KEY = 'expenses.drive_index_title_pattern';

// ---------------------------------------------------------------------------
// The index sheet
// ---------------------------------------------------------------------------

/**
 * The six row statuses. The canonical value is the Hebrew one (stored in run details), and the
 * English label is a supported alias. Any other value (totals, rate source, titles) is not a data row.
 */
export const SHEET_STATUSES = ['הוצאה', 'לא הושג', 'נפסל לא עסקי', 'נדחה הכנסה', 'לא הוצאה', 'מסמך אישי'] as const;
export type SheetStatus = (typeof SHEET_STATUSES)[number];
export const SHEET_EXPENSE_STATUS: SheetStatus = 'הוצאה';

const STATUS_ALIASES: Record<string, SheetStatus> = {
  expense: 'הוצאה',
  'not obtained': 'לא הושג',
  'rejected not business': 'נפסל לא עסקי',
  'rejected income': 'נדחה הכנסה',
  'not an expense': 'לא הוצאה',
  'not expense': 'לא הוצאה',
  'personal document': 'מסמך אישי',
};

function canonicalStatus(value: string): SheetStatus | null {
  const v = value.trim();
  if ((SHEET_STATUSES as readonly string[]).includes(v)) return v as SheetStatus;
  return STATUS_ALIASES[v.toLowerCase().replace(/\s+/g, ' ')] ?? null;
}

/**
 * Header names, read from the sheet's header row. The English set is the default. The Hebrew set
 * is a supported alias, so a sheet written in Hebrew imports the same way.
 */
const COLUMNS = {
  status: ['Status', 'סטטוס'],
  date: ['Date', 'תאריך'],
  supplier: ['Supplier', 'ספק'],
  supplierTaxId: ['Supplier tax ID', 'ח.פ ספק'],
  documentType: ['Document type', 'סוג מסמך'],
  beforeVat: ['Before VAT', 'לפני מע"מ'],
  vat: ['VAT', 'מע"מ'],
  total: ['Total', 'סה"כ'],
  currency: ['Currency', 'מטבע'],
  rate: ['Exchange rate', 'שער המרה'],
  rateDate: ['Rate date', 'תאריך השער'],
  totalIls: ['Total ILS', 'סה"כ בשקלים'],
  category: ['Category', 'קטגוריה'],
  fixed: ['Fixed', 'קבוע'],
  documentNumber: ['Document number', 'מספר מסמך'],
  link: ['File link', 'קישור לקובץ'],
  notes: ['Notes', 'הערות'],
} as const;
type Column = keyof typeof COLUMNS;

function headerMatches(cell: string, column: Column): boolean {
  const normalized = normalizeHeader(cell).toLowerCase();
  return COLUMNS[column].some((name) => name.toLowerCase() === normalized);
}

export interface SheetRow {
  /** 1-based row number in the sheet, for the summary. */
  rowNumber: number;
  status: SheetStatus;
  cells: Record<Column, string>;
}

/** Gershayim (״) and typographic quotes read as a plain double quote, so `מע״מ` matches `מע"מ`. */
function normalizeHeader(value: string): string {
  return value.replace(/[״“”]/g, '"').replace(/\s+/g, ' ').trim();
}

/** Finds the header row by its Status cell, maps columns by name, and keeps only rows with one of the six statuses. */
export function parseIndexSheet(rows: string[][]): SheetRow[] {
  const headerIndex = rows.findIndex((row) => row.some((cell) => headerMatches(cell, 'status')));
  if (headerIndex < 0) throw new ValidationError('The index sheet has no Status header row.');
  const header = rows[headerIndex]!;
  const position = {} as Record<Column, number>;
  for (const key of Object.keys(COLUMNS) as Column[]) position[key] = header.findIndex((cell) => headerMatches(cell, key));
  for (const required of ['status', 'date', 'supplier', 'total', 'currency'] as const) {
    if (position[required] < 0) throw new ValidationError(`The index sheet has no ${COLUMNS[required][0]} column.`);
  }

  const out: SheetRow[] = [];
  rows.slice(headerIndex + 1).forEach((row, i) => {
    const status = canonicalStatus(row[position.status] ?? '');
    if (!status) return;
    const cells = {} as Record<Column, string>;
    for (const key of Object.keys(COLUMNS) as Column[]) cells[key] = position[key] < 0 ? '' : (row[position[key]] ?? '').trim();
    out.push({ rowNumber: headerIndex + i + 2, status, cells });
  });
  return out;
}

/** "1,234.50", "$10.00" or "₪ 30.01" to a plain decimal string. Empty stays empty. */
export function sheetAmount(value: string): string {
  return value.replace(/[^\d.,-]/g, '').replace(/,/g, '');
}

/** YYYY-MM-DD, or the Israeli day-first forms D/M/YYYY and D.M.YYYY. Null when unreadable. */
export function sheetDate(value: string): string | null {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(v);
  if (!m) return null;
  return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

/** The file id in a Drive link (`/file/d/<id>/view` or `?id=<id>`). Null for Gmail and other links. */
export function driveFileIdFromUrl(url: string): string | null {
  if (!/^https:\/\/drive\.google\.com\//.test(url.trim())) return null;
  return /\/file\/d\/([\w-]+)/.exec(url)?.[1] ?? /[?&]id=([\w-]+)/.exec(url)?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Issued by this business (fallback path only: the sheet already marks these נדחה הכנסה)
// ---------------------------------------------------------------------------

/** Who "this business" is, from the business profile. Never hard-coded. */
export interface BusinessIdentity {
  names: string[];
  taxId: string | null;
}

/** Folds case, spaces, dots, dashes and underscores, so "Sample_Business-Ltd" matches "sample business ltd". */
function fold(value: string): string {
  return value.toLowerCase().replace(/[\s_.-]+/g, ' ').trim();
}

/** The business names and tax id from the profile. The OWNER_TAX_ID secret fills a missing tax id. */
export async function loadBusinessIdentity(db: D1Database, ownerTaxId?: string): Promise<BusinessIdentity> {
  const row = await first<{ name_en: string; name_he: string; tax_id: string | null }>(
    db,
    'SELECT name_en, name_he, tax_id FROM business_profile WHERE id = 1',
  );
  const names = [row?.name_en ?? '', row?.name_he ?? ''].map(fold).filter((n) => n.length >= 3);
  return { names, taxId: row?.tax_id?.trim() || ownerTaxId?.trim() || null };
}

/** The original name after the receipts skill's `YYYY-MM-DD_<gmail-id>_` prefix. */
function originalName(filename: string): string {
  return filename.replace(/^\d{4}-\d{2}-\d{2}_[^_]+_/, '');
}

export function filenameShowsSelf(filename: string, identity: BusinessIdentity): boolean {
  const name = fold(originalName(filename));
  return identity.names.some((n) => name.includes(n));
}

export function extractionShowsSelf(extracted: ExtractedExpense, identity: BusinessIdentity): boolean {
  const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
  if (identity.taxId && digits(identity.taxId) && digits(extracted.supplierId) === digits(identity.taxId)) return true;
  const supplier = fold(extracted.supplierName);
  return identity.names.some((n) => supplier.includes(n));
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** The saved root folder, or null until the owner saves one in Settings > Expenses. */
export async function effectiveDriveRoot(db: D1Database): Promise<string | null> {
  return service.getDriveRootFolder(db);
}

/** The saved index sheet title pattern, or `Expense index YYYY-MM`. */
export async function getIndexTitlePattern(db: D1Database): Promise<string> {
  const row = await first<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', INDEX_TITLE_SETTING_KEY);
  return row?.value?.trim() || DEFAULT_INDEX_TITLE_PATTERN;
}

export async function setIndexTitlePattern(db: D1Database, pattern: string, actor: AuditActor): Promise<void> {
  await transaction(db, [
    stmt(
      db,
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = ?`,
      INDEX_TITLE_SETTING_KEY,
      pattern,
      nowIso(),
    ),
    auditStatement(db, actor, 'settings.update', 'settings', INDEX_TITLE_SETTING_KEY, { pattern }),
  ]);
}

export async function getDailySync(db: D1Database): Promise<boolean> {
  const row = await first<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', DAILY_SYNC_SETTING_KEY);
  return row?.value === '1';
}

export async function setDailySync(db: D1Database, enabled: boolean, actor: AuditActor): Promise<void> {
  await transaction(db, [
    stmt(
      db,
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = ?`,
      DAILY_SYNC_SETTING_KEY,
      enabled ? '1' : '0',
      nowIso(),
    ),
    auditStatement(db, actor, 'settings.update', 'settings', DAILY_SYNC_SETTING_KEY, { enabled }),
  ]);
}

// ---------------------------------------------------------------------------
// Duplicate checks against everything already recorded, uploads included
// ---------------------------------------------------------------------------

export type SkipReason = 'drive_file' | 'file_hash' | 'supplier_number' | 'supplier_date_total' | 'issued_by_self';

export interface ImportSkip {
  /** "Row 7: Modelco, PBC MC-0003" or the Drive file name. */
  ref: string;
  reason: SkipReason;
  /** The existing expense it matched. Null for issued-by-this-business skips. */
  expenseId: number | null;
}

interface Match {
  reason: SkipReason;
  expenseId: number | null;
}

/** Lowercase, no punctuation, no legal suffix: "Modelco, PBC" and "modelco" compare equal. */
export function normalizeSupplierName(name: string): string {
  return name
    .toLowerCase()
    .replace(/בע"?מ|בע״מ/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(inc|incorporated|ltd|limited|llc|pbc|corp|corporation|co|gmbh|plc|sa|bv)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every supplier that is the same business: same tax id, or the same name once normalized. */
async function matchingSupplierIds(db: D1Database, name: string, taxId: string | null): Promise<number[]> {
  const suppliers = await all<{ id: number; name: string; tax_id: string | null }>(db, 'SELECT id, name, tax_id FROM suppliers ORDER BY id');
  const wanted = normalizeSupplierName(name);
  const tax = taxId?.trim() || null;
  return suppliers
    .filter((s) => (tax && s.tax_id?.trim() === tax) || (wanted && normalizeSupplierName(s.name) === wanted))
    .map((s) => s.id);
}

async function matchByDriveFile(db: D1Database, driveFileId: string): Promise<Match | null> {
  const row = await first<{ expense_id: number | null }>(db, 'SELECT expense_id FROM expense_files WHERE drive_file_id = ?', driveFileId);
  return row ? { reason: 'drive_file', expenseId: row.expense_id } : null;
}

async function matchByHash(db: D1Database, sha256: string): Promise<Match | null> {
  const row = await first<{ expense_id: number }>(
    db,
    'SELECT expense_id FROM expense_files WHERE sha256 = ? AND expense_id IS NOT NULL ORDER BY id LIMIT 1',
    sha256,
  );
  return row ? { reason: 'file_hash', expenseId: row.expense_id } : null;
}

function inList(ids: number[]): string {
  return ids.map(() => '?').join(', ');
}

async function matchBySupplierNumber(db: D1Database, supplierIds: number[], documentNumber: string | null): Promise<Match | null> {
  if (!documentNumber || supplierIds.length === 0) return null;
  const row = await first<{ id: number }>(
    db,
    `SELECT id FROM expenses WHERE supplier_id IN (${inList(supplierIds)}) AND document_number = ? AND status != 'not_expense' ORDER BY id LIMIT 1`,
    ...supplierIds,
    documentNumber,
  );
  return row ? { reason: 'supplier_number', expenseId: row.id } : null;
}

/**
 * Same supplier, same date, total in ILS within one agora: flagged, not created. Two documents
 * that both carry a document number and the numbers differ are two real charges (e.g. two
 * identical top-ups from one supplier on one day), never a duplicate.
 */
async function matchBySupplierDateTotal(
  db: D1Database,
  supplierIds: number[],
  date: string,
  amountIlsMinor: number | null,
  documentNumber: string | null,
): Promise<Match | null> {
  if (amountIlsMinor === null || supplierIds.length === 0) return null;
  const row = await first<{ id: number }>(
    db,
    `SELECT id FROM expenses
     WHERE supplier_id IN (${inList(supplierIds)}) AND document_date = ? AND amount_ils_minor IS NOT NULL
       AND ABS(amount_ils_minor - ?) <= 1 AND status != 'not_expense'
       AND (? IS NULL OR document_number IS NULL OR trim(document_number) = '' OR document_number = ?)
     ORDER BY id LIMIT 1`,
    ...supplierIds,
    date,
    amountIlsMinor,
    documentNumber,
    documentNumber,
  );
  return row ? { reason: 'supplier_date_total', expenseId: row.id } : null;
}

// ---------------------------------------------------------------------------
// Creating records
// ---------------------------------------------------------------------------

async function supplierFor(db: D1Database, ids: number[], name: string, taxId: string | null, currency: Currency, actor: AuditActor) {
  if (ids.length > 0) return ids[0]!;
  return (await service.createSupplier(db, { name, taxId, defaultCurrency: currency }, actor)).id;
}

/** Matches a category by English name or key. Creates one named as in the sheet when nothing matches. */
async function categoryFor(db: D1Database, name: string, actor: AuditActor): Promise<number | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const found = await first<{ id: number }>(
    db,
    'SELECT id FROM expense_categories WHERE name_en = ? COLLATE NOCASE OR key = ? COLLATE NOCASE ORDER BY id LIMIT 1',
    trimmed,
    trimmed,
  );
  if (found) return found.id;
  const hash = await sha256Hex(new TextEncoder().encode(trimmed).buffer as ArrayBuffer);
  return (await service.createCategory(db, { key: `sheet_${hash.slice(0, 10)}`, nameEn: trimmed, sortOrder: 100 }, actor)).id;
}

async function storeDriveFile(env: Env, file: DriveFile, bytes: ArrayBuffer, sha256: string, actor: AuditActor): Promise<number> {
  const key = r2KeyFor(sha256, file.name);
  await storeFile(env, key, bytes, file.mimeType);
  const { lastRowId } = await run(
    env.DB,
    `INSERT INTO expense_files (source, drive_file_id, r2_key, filename, content_type, size_bytes, sha256)
     VALUES ('drive', ?, ?, ?, ?, ?, ?)`,
    file.id,
    key,
    file.name,
    file.mimeType,
    bytes.byteLength,
    sha256,
  );
  await auditAs(env.DB, actor, 'expense_file.ingest', 'expense_file', lastRowId, { source: 'drive', filename: file.name });
  return lastRowId;
}

interface NewExpense {
  fileId: number | null;
  supplierId: number;
  categoryId: number | null;
  status: ExpenseStatus;
  documentNumber: string | null;
  documentDate: string;
  documentType: string | null;
  currency: Currency;
  amountMinor: number;
  vatAmountMinor: number;
  ils: Awaited<ReturnType<typeof convertToIls>>;
  isFixed: boolean | null;
  notes: string | null;
  sourceJson: unknown;
}

async function insertExpense(db: D1Database, e: NewExpense, actor: AuditActor): Promise<number> {
  const { lastRowId } = await run(
    db,
    `INSERT INTO expenses (
       file_id, supplier_id, category_id, status, document_number, document_date, document_type, currency,
       amount_minor, vat_amount_minor, amount_ils_minor, fx_rate, fx_rate_date, fx_source, is_fixed, notes, extracted_json
     ) VALUES (?, ?, COALESCE(?, (SELECT default_category_id FROM suppliers WHERE id = ?)), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    e.fileId,
    e.supplierId,
    e.categoryId,
    e.supplierId,
    e.status,
    e.documentNumber,
    e.documentDate,
    e.documentType,
    e.currency,
    e.amountMinor,
    e.vatAmountMinor,
    e.ils.amountIlsMinor,
    e.ils.fxRate,
    e.ils.fxRateDate,
    e.ils.fxSource,
    e.isFixed === null ? null : e.isFixed ? 1 : 0,
    e.notes,
    JSON.stringify(e.sourceJson),
  );
  const statements = [auditStatement(db, actor, 'expense.create', 'expense', lastRowId, { status: e.status, supplierId: e.supplierId, source: 'drive_import' })];
  if (e.fileId !== null) statements.unshift(stmt(db, 'UPDATE expense_files SET expense_id = ? WHERE id = ?', lastRowId, e.fileId));
  await transaction(db, statements);
  return lastRowId;
}

// ---------------------------------------------------------------------------
// One month
// ---------------------------------------------------------------------------

export type ImportTrigger = 'manual' | 'daily';

export interface ImportSummary {
  runId: number;
  yearMonth: string;
  trigger: ImportTrigger;
  /** sheet: the index sheet drove it. folder: no sheet, files went to AI extraction. none: neither exists. failed: Google or config error. */
  source: 'sheet' | 'folder' | 'none' | 'failed';
  startedAt: string;
  finishedAt: string;
  filesSeen: number;
  created: number;
  skippedDuplicate: number;
  skippedNotExpense: number;
  skippedIssuedBySelf: number;
  errors: number;
  /** Sheet rows by status, for example { "הוצאה": 12, "לא הוצאה": 2 }. Empty on the folder path. */
  statusCounts: Record<string, number>;
  createdIds: number[];
  skips: ImportSkip[];
  errorList: { ref: string; message: string }[];
}

type Working = Omit<ImportSummary, 'runId' | 'finishedAt'>;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function skip(summary: Working, ref: string, match: Match): void {
  summary.skips.push({ ref, reason: match.reason, expenseId: match.expenseId });
  if (match.reason === 'issued_by_self') summary.skippedIssuedBySelf += 1;
  else summary.skippedDuplicate += 1;
}

function sheetNotes(row: SheetRow, currency: Currency): string | null {
  const parts: string[] = [];
  if (row.cells.notes) parts.push(row.cells.notes);
  if (currency !== HOME_CURRENCY && row.cells.rate) {
    const date = sheetDate(row.cells.rateDate) ?? row.cells.rateDate;
    parts.push(`Sheet rate: ${row.cells.rate} (ECB${date ? `, ${date}` : ''})`);
  }
  return parts.length ? parts.join('\n') : null;
}

async function importSheetRow(
  env: Env,
  deps: Deps,
  row: SheetRow,
  folderFiles: Map<string, DriveFile>,
  actor: AuditActor,
  summary: Working,
): Promise<void> {
  const c = row.cells;
  const ref = `Row ${row.rowNumber}: ${c.supplier}${c.documentNumber ? ` ${c.documentNumber}` : ''}`;
  const driveFileId = driveFileIdFromUrl(c.link);
  if (driveFileId) {
    const hit = await matchByDriveFile(env.DB, driveFileId);
    if (hit) return skip(summary, ref, hit);
  }

  if (!c.supplier) throw new ValidationError('The row has no supplier.');
  const currencyCode = (c.currency || HOME_CURRENCY).toUpperCase();
  if (!isCurrency(currencyCode)) throw new ValidationError(`Unsupported currency "${c.currency}".`);
  const currency = assertCurrency(currencyCode);
  const date = sheetDate(c.date);
  if (!date) throw new ValidationError(`Unreadable date "${c.date}".`);
  const amountMinor = parseMajor(sheetAmount(c.total), currency);
  const vatText = sheetAmount(c.vat);
  const vatAmountMinor = vatText ? parseMajor(vatText, currency) : 0;
  const taxId = c.supplierTaxId || null;
  const documentNumber = c.documentNumber || null;

  const supplierIds = await matchingSupplierIds(env.DB, c.supplier, taxId);
  const byNumber = await matchBySupplierNumber(env.DB, supplierIds, documentNumber);
  if (byNumber) return skip(summary, ref, byNumber);
  const ils = await convertToIls(deps.fx, currency, date, amountMinor);
  const byTotal = await matchBySupplierDateTotal(env.DB, supplierIds, date, ils.amountIlsMinor, documentNumber);
  if (byTotal) return skip(summary, ref, byTotal);

  let file: { meta: DriveFile; bytes: ArrayBuffer; sha256: string } | null = null;
  if (driveFileId) {
    const bytes = await deps.drive.downloadFile(driveFileId);
    const sha256 = await sha256Hex(bytes);
    const byHash = await matchByHash(env.DB, sha256);
    if (byHash) return skip(summary, ref, byHash);
    const meta = folderFiles.get(driveFileId) ?? {
      id: driveFileId,
      name: `${date}_${c.supplier.replace(/[^\p{L}\p{N}]+/gu, '-')}_${documentNumber ?? driveFileId}.pdf`,
      mimeType: 'application/pdf',
      modifiedTime: '',
    };
    file = { meta, bytes, sha256 };
  }

  const supplierId = await supplierFor(env.DB, supplierIds, c.supplier, taxId, currency, actor);
  const categoryId = await categoryFor(env.DB, c.category, actor);
  const fileId = file ? await storeDriveFile(env, file.meta, file.bytes, file.sha256, actor) : null;
  const id = await insertExpense(
    env.DB,
    {
      fileId,
      supplierId,
      categoryId,
      status: 'filed',
      documentNumber,
      documentDate: date,
      documentType: c.documentType || null,
      currency,
      amountMinor,
      vatAmountMinor,
      ils,
      isFixed: /^(קבוע|fixed|yes)$/i.test(c.fixed) ? true : /^(לא קבוע|not fixed|no)$/i.test(c.fixed) ? false : null,
      notes: sheetNotes(row, currency),
      sourceJson: { source: 'index_sheet', row: row.rowNumber, ...c },
    },
    actor,
  );
  summary.created += 1;
  summary.createdIds.push(id);
}

async function importFolderFile(
  env: Env,
  deps: Deps,
  f: DriveFile,
  identity: BusinessIdentity,
  actor: AuditActor,
  summary: Working,
): Promise<void> {
  const ref = f.name;
  const hit = await matchByDriveFile(env.DB, f.id);
  if (hit) return skip(summary, ref, hit);
  if (filenameShowsSelf(f.name, identity)) return skip(summary, ref, { reason: 'issued_by_self', expenseId: null });

  const bytes = await deps.drive.downloadFile(f.id);
  const sha256 = await sha256Hex(bytes);
  const byHash = await matchByHash(env.DB, sha256);
  if (byHash) return skip(summary, ref, byHash);

  const extracted = await deps.extractor.extract({ bytes, contentType: f.mimeType, filename: f.name });
  if (extractionShowsSelf(extracted, identity)) return skip(summary, ref, { reason: 'issued_by_self', expenseId: null });

  const currency = assertCurrency(extracted.currency);
  const amountMinor = parseMajor(extracted.amount, currency);
  const vatAmountMinor = extracted.vatAmount ? parseMajor(extracted.vatAmount, currency) : 0;
  // The receipts skill names files YYYY-MM-DD_..., so the file date stands in when the document shows none.
  const date = extracted.date ?? /^(\d{4}-\d{2}-\d{2})_/.exec(f.name)?.[1] ?? f.modifiedTime.slice(0, 10);
  const documentNumber = extracted.documentNumber ?? null;
  const taxId = extracted.supplierId?.trim() || null;

  const supplierIds = await matchingSupplierIds(env.DB, extracted.supplierName, taxId);
  const byNumber = await matchBySupplierNumber(env.DB, supplierIds, documentNumber);
  if (byNumber) return skip(summary, ref, byNumber);
  const ils = await convertToIls(deps.fx, currency, date, amountMinor);
  const byTotal = await matchBySupplierDateTotal(env.DB, supplierIds, date, ils.amountIlsMinor, documentNumber);
  if (byTotal) return skip(summary, ref, byTotal);

  const supplierId = await supplierFor(env.DB, supplierIds, extracted.supplierName, taxId, currency, actor);
  const fileId = await storeDriveFile(env, f, bytes, sha256, actor);
  const id = await insertExpense(
    env.DB,
    {
      fileId,
      supplierId,
      categoryId: null,
      status: 'new',
      documentNumber,
      documentDate: date,
      documentType: extracted.documentType ?? null,
      currency,
      amountMinor,
      vatAmountMinor,
      ils,
      isFixed: null,
      notes: null,
      sourceJson: extracted,
    },
    actor,
  );
  summary.created += 1;
  summary.createdIds.push(id);
}

async function runMonth(env: Env, deps: Deps, yearMonth: string, actor: AuditActor, summary: Working): Promise<void> {
  const root = await effectiveDriveRoot(env.DB);
  if (!root) throw new ConfigError('Set the Google Drive folder id in Settings > Expenses first.');
  const title = indexSheetTitle(yearMonth, await getIndexTitlePattern(env.DB));
  const [sheetId, monthFolderId] = await Promise.all([
    deps.drive.findIndexSheet(root, yearMonth, title),
    deps.drive.findMonthFolder(root, yearMonth),
  ]);
  // Only files directly in the month folder. Subfolders, `_to_be_deleted` among them, are never read.
  const files = monthFolderId
    ? (await deps.drive.listFiles(monthFolderId)).filter((f) => f.mimeType !== FOLDER_MIME && !f.mimeType.startsWith('application/vnd.google-apps.'))
    : [];

  if (sheetId) {
    summary.source = 'sheet';
    const rows = parseIndexSheet(await deps.drive.readSheet(sheetId));
    const byId = new Map(files.map((f) => [f.id, f]));
    for (const row of rows) {
      summary.filesSeen += 1;
      summary.statusCounts[row.status] = (summary.statusCounts[row.status] ?? 0) + 1;
      if (row.status !== SHEET_EXPENSE_STATUS) {
        summary.skippedNotExpense += 1;
        continue;
      }
      try {
        await importSheetRow(env, deps, row, byId, actor, summary);
      } catch (err) {
        summary.errors += 1;
        summary.errorList.push({ ref: `Row ${row.rowNumber}: ${row.cells.supplier}`, message: describe(err) });
      }
    }
    return;
  }

  if (!monthFolderId) {
    summary.source = 'none';
    return;
  }
  summary.source = 'folder';
  const identity = await loadBusinessIdentity(env.DB, env.OWNER_TAX_ID);
  for (const f of files) {
    summary.filesSeen += 1;
    try {
      await importFolderFile(env, deps, f, identity, actor, summary);
    } catch (err) {
      summary.errors += 1;
      summary.errorList.push({ ref: f.name, message: describe(err) });
    }
  }
}

/**
 * Imports one month and logs the run. Safe to repeat: a rerun only adds what is new. Google or
 * configuration failures are recorded as a failed run and returned, not thrown, so the daily job
 * moves on to the next month and the button shows the reason.
 */
export async function importMonth(env: Env, deps: Deps, yearMonth: string, trigger: ImportTrigger, actor: AuditActor): Promise<ImportSummary> {
  monthFolderName(yearMonth);
  const summary: Working = {
    yearMonth,
    trigger,
    source: 'none',
    startedAt: nowIso(),
    filesSeen: 0,
    created: 0,
    skippedDuplicate: 0,
    skippedNotExpense: 0,
    skippedIssuedBySelf: 0,
    errors: 0,
    statusCounts: {},
    createdIds: [],
    skips: [],
    errorList: [],
  };
  try {
    await runMonth(env, deps, yearMonth, actor, summary);
  } catch (err) {
    summary.source = 'failed';
    summary.errors += 1;
    summary.errorList.push({ ref: yearMonth, message: describe(err) });
  }
  const finishedAt = nowIso();
  const details = { statusCounts: summary.statusCounts, createdIds: summary.createdIds, skips: summary.skips, errorList: summary.errorList };
  const { lastRowId } = await run(
    env.DB,
    `INSERT INTO drive_import_runs (
       year_month, trigger, source, started_at, finished_at, files_seen, created,
       skipped_duplicate, skipped_not_expense, skipped_issued_by_self, errors, details_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    yearMonth,
    trigger,
    summary.source,
    summary.startedAt,
    finishedAt,
    summary.filesSeen,
    summary.created,
    summary.skippedDuplicate,
    summary.skippedNotExpense,
    summary.skippedIssuedBySelf,
    summary.errors,
    JSON.stringify(details),
  );
  await auditAs(env.DB, actor, 'expenses.drive_import', 'drive_import_run', lastRowId, {
    yearMonth,
    trigger,
    source: summary.source,
    created: summary.created,
    errors: summary.errors,
  });
  return { ...summary, runId: lastRowId, finishedAt };
}

interface RunRow {
  id: number;
  year_month: string;
  trigger: ImportTrigger;
  source: ImportSummary['source'];
  started_at: string;
  finished_at: string;
  files_seen: number;
  created: number;
  skipped_duplicate: number;
  skipped_not_expense: number;
  skipped_issued_by_self: number;
  errors: number;
  details_json: string;
}

export async function listImportRuns(db: D1Database, limit = 20): Promise<ImportSummary[]> {
  const rows = await all<RunRow>(db, 'SELECT * FROM drive_import_runs ORDER BY id DESC LIMIT ?', limit);
  return rows.map((r) => {
    const d = JSON.parse(r.details_json) as Pick<ImportSummary, 'statusCounts' | 'createdIds' | 'skips' | 'errorList'>;
    return {
      runId: r.id,
      yearMonth: r.year_month,
      trigger: r.trigger,
      source: r.source,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      filesSeen: r.files_seen,
      created: r.created,
      skippedDuplicate: r.skipped_duplicate,
      skippedNotExpense: r.skipped_not_expense,
      skippedIssuedBySelf: r.skipped_issued_by_self,
      errors: r.errors,
      statusCounts: d.statusCounts ?? {},
      createdIds: d.createdIds ?? [],
      skips: d.skips ?? [],
      errorList: d.errorList ?? [],
    };
  });
}

/** "2026-09" to "2026-08". */
export function previousMonth(yearMonth: string): string {
  const [y, m] = monthFolderName(yearMonth).split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The months the daily job imports on a given Israel date: this month, plus last month on days 1 to 5. */
export function dailyMonths(today: string): string[] {
  const month = today.slice(0, 7);
  return Number(today.slice(8, 10)) <= 5 ? [previousMonth(month), month] : [month];
}

/** Reuses the existing 08:00 UTC daily slot (the R09 access check) rather than a new cron trigger. */
export const DRIVE_DAILY_CRON = '0 8 * * *';

/** The daily job. Does nothing while the switch is off. Each month is logged as its own run. */
export async function runDailyDriveImport(env: Env, deps: Deps, today: string, actor: AuditActor): Promise<ImportSummary[]> {
  if (!(await getDailySync(env.DB))) return [];
  const out: ImportSummary[] = [];
  for (const month of dailyMonths(today)) out.push(await importMonth(env, deps, month, 'daily', actor));
  return out;
}
