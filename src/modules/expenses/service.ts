import type { AuditActor } from '../../core/audit';
import { auditAs, auditStatement } from '../../core/audit';
import { all, first, nowIso, run, stmt, transaction } from '../../core/db';
import { NotFoundError } from '../../core/errors';
import { type Currency, assertCurrency, formatMinor, parseMajor } from '../../core/money';
import type { Env } from '../../env';
import type { DriveSource } from './drive';
import { r2KeyFor, readFile, sha256Hex, storeFile } from './files';
import { type RateSource, convertToIls, convertWithRate } from './fx';
import type { Extractor } from './extractor';
import {
  type CategoryInput,
  type CategoryRow,
  type ExpenseFileRow,
  type ExpenseRow,
  type ExpenseStatus,
  type ExpenseUpdate,
  type ExtractedExpense,
  type StatusUpdate,
  type SupplierInput,
  type SupplierRow,
} from './types';

export interface Deps {
  drive: DriveSource;
  extractor: Extractor;
  fx: RateSource;
}

// ---------------------------------------------------------------------------
// Suppliers and categories
// ---------------------------------------------------------------------------

export async function listSuppliers(db: D1Database): Promise<SupplierRow[]> {
  return all<SupplierRow>(db, 'SELECT * FROM suppliers ORDER BY name');
}

export async function createSupplier(db: D1Database, input: SupplierInput, actor: AuditActor): Promise<SupplierRow> {
  const { lastRowId } = await run(
    db,
    `INSERT INTO suppliers (name, tax_id, country, default_category_id, default_currency, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    input.name,
    input.taxId ?? null,
    input.country ?? 'IL',
    input.defaultCategoryId ?? null,
    input.defaultCurrency ?? 'ILS',
    input.notes ?? null,
  );
  const row = (await first<SupplierRow>(db, 'SELECT * FROM suppliers WHERE id = ?', lastRowId))!;
  await auditAs(db, actor, 'supplier.create', 'supplier', lastRowId, { name: input.name });
  return row;
}

export async function updateSupplier(db: D1Database, id: number, input: Partial<SupplierInput>, actor: AuditActor): Promise<SupplierRow> {
  const existing = await first<SupplierRow>(db, 'SELECT * FROM suppliers WHERE id = ?', id);
  if (!existing) throw new NotFoundError('Supplier', id);
  await transaction(db, [
    stmt(
      db,
      `UPDATE suppliers SET name = ?, tax_id = ?, country = ?, default_category_id = ?, default_currency = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      input.name ?? existing.name,
      input.taxId !== undefined ? input.taxId : existing.tax_id,
      input.country ?? existing.country,
      input.defaultCategoryId !== undefined ? input.defaultCategoryId : existing.default_category_id,
      input.defaultCurrency ?? existing.default_currency,
      input.notes !== undefined ? input.notes : existing.notes,
      nowIso(),
      id,
    ),
    auditStatement(db, actor, 'supplier.update', 'supplier', id, input),
  ]);
  return (await first<SupplierRow>(db, 'SELECT * FROM suppliers WHERE id = ?', id))!;
}

export async function listCategories(db: D1Database, includeInactive = false): Promise<CategoryRow[]> {
  return all<CategoryRow>(
    db,
    includeInactive
      ? 'SELECT * FROM expense_categories ORDER BY sort_order, name_en'
      : 'SELECT * FROM expense_categories WHERE active = 1 ORDER BY sort_order, name_en',
  );
}

export async function createCategory(db: D1Database, input: CategoryInput, actor: AuditActor): Promise<CategoryRow> {
  const { lastRowId } = await run(
    db,
    'INSERT INTO expense_categories (key, name_en, sort_order) VALUES (?, ?, ?)',
    input.key,
    input.nameEn,
    input.sortOrder ?? 0,
  );
  await auditAs(db, actor, 'category.create', 'expense_category', lastRowId, input);
  return (await first<CategoryRow>(db, 'SELECT * FROM expense_categories WHERE id = ?', lastRowId))!;
}

export async function updateCategory(
  db: D1Database,
  id: number,
  input: { nameEn?: string; sortOrder?: number; active?: boolean },
  actor: AuditActor,
): Promise<CategoryRow> {
  const existing = await first<CategoryRow>(db, 'SELECT * FROM expense_categories WHERE id = ?', id);
  if (!existing) throw new NotFoundError('Category', id);
  await transaction(db, [
    stmt(
      db,
      'UPDATE expense_categories SET name_en = ?, sort_order = ?, active = ?, updated_at = ? WHERE id = ?',
      input.nameEn ?? existing.name_en,
      input.sortOrder ?? existing.sort_order,
      input.active === undefined ? existing.active : input.active ? 1 : 0,
      nowIso(),
      id,
    ),
    auditStatement(db, actor, 'category.update', 'expense_category', id, input),
  ]);
  return (await first<CategoryRow>(db, 'SELECT * FROM expense_categories WHERE id = ?', id))!;
}

/** Matches a supplier by tax id first, then by exact name. Creates one when nothing matches. */
async function resolveSupplier(db: D1Database, extracted: ExtractedExpense, actor: AuditActor): Promise<number> {
  const taxId = extracted.supplierId?.trim() || null;
  if (taxId) {
    const byTax = await first<{ id: number }>(db, 'SELECT id FROM suppliers WHERE tax_id = ?', taxId);
    if (byTax) return byTax.id;
  }
  const byName = await first<{ id: number }>(db, 'SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE', extracted.supplierName);
  if (byName) return byName.id;
  const created = await createSupplier(
    db,
    { name: extracted.supplierName, taxId, defaultCurrency: extracted.currency as Currency },
    actor,
  );
  return created.id;
}

// ---------------------------------------------------------------------------
// Duplicate detection (runs/R07-expenses.md: "on supplier plus document number, and on file hash")
// ---------------------------------------------------------------------------

export interface DuplicateCheck {
  duplicateOfId: number | null;
  reason: string | null;
}

async function checkDuplicate(
  db: D1Database,
  args: { fileSha256: string; fileId: number; supplierId: number; documentNumber: string | null },
): Promise<DuplicateCheck> {
  const byHash = await first<{ expense_id: number | null }>(
    db,
    `SELECT expense_id FROM expense_files WHERE sha256 = ? AND id != ? AND expense_id IS NOT NULL ORDER BY id LIMIT 1`,
    args.fileSha256,
    args.fileId,
  );
  if (byHash?.expense_id) return { duplicateOfId: byHash.expense_id, reason: 'Same file already recorded' };

  if (args.documentNumber) {
    const byNumber = await first<{ id: number }>(
      db,
      `SELECT id FROM expenses WHERE supplier_id = ? AND document_number = ? AND status != 'not_expense' ORDER BY id LIMIT 1`,
      args.supplierId,
      args.documentNumber,
    );
    if (byNumber) return { duplicateOfId: byNumber.id, reason: `Same supplier and document number as expense ${byNumber.id}` };
  }
  return { duplicateOfId: null, reason: null };
}

// ---------------------------------------------------------------------------
// Ingest: file bytes in, an expense row out
// ---------------------------------------------------------------------------

export interface IngestInput {
  bytes: ArrayBuffer;
  filename: string;
  contentType: string;
  source: 'drive' | 'upload';
  driveFileId?: string | null;
}

/** Stores the file in R2, records it, and returns null when a Drive file was already ingested. */
async function recordFile(env: Env, input: IngestInput, actor: AuditActor): Promise<ExpenseFileRow | null> {
  if (input.driveFileId) {
    const already = await first<{ id: number }>(env.DB, 'SELECT id FROM expense_files WHERE drive_file_id = ?', input.driveFileId);
    if (already) return null;
  }
  const sha256 = await sha256Hex(input.bytes);
  const key = r2KeyFor(sha256, input.filename);
  await storeFile(env, key, input.bytes, input.contentType);
  const { lastRowId } = await run(
    env.DB,
    `INSERT INTO expense_files (source, drive_file_id, r2_key, filename, content_type, size_bytes, sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.source,
    input.driveFileId ?? null,
    key,
    input.filename,
    input.contentType,
    input.bytes.byteLength,
    sha256,
  );
  await auditAs(env.DB, actor, 'expense_file.ingest', 'expense_file', lastRowId, {
    source: input.source,
    filename: input.filename,
  });
  return (await first<ExpenseFileRow>(env.DB, 'SELECT * FROM expense_files WHERE id = ?', lastRowId))!;
}

/** Runs extraction, resolves the supplier, checks duplicates, converts to ILS and creates the expense. */
async function createExpenseFromExtraction(env: Env, deps: Deps, file: ExpenseFileRow, actor: AuditActor): Promise<ExpenseRow> {
  const extracted = await deps.extractor.extract({ bytes: await downloadForExtraction(env, file), contentType: file.content_type, filename: file.filename });
  const currency = assertCurrency(extracted.currency);
  const amountMinor = parseMajor(extracted.amount, currency);
  const vatAmountMinor = extracted.vatAmount ? parseMajor(extracted.vatAmount, currency) : 0;
  const documentDate = extracted.date ?? new Date().toISOString().slice(0, 10);
  const supplierId = await resolveSupplier(env.DB, extracted, actor);

  const duplicate = await checkDuplicate(env.DB, {
    fileSha256: file.sha256,
    fileId: file.id,
    supplierId,
    documentNumber: extracted.documentNumber ?? null,
  });
  const status: ExpenseStatus = duplicate.duplicateOfId ? 'duplicate' : 'new';

  const ils = await convertToIls(deps.fx, currency, documentDate, amountMinor);

  const { lastRowId } = await run(
    env.DB,
    `INSERT INTO expenses (
       file_id, supplier_id, category_id, status, status_reason, duplicate_of_id,
       document_number, document_date, document_type, currency, amount_minor, vat_amount_minor,
       amount_ils_minor, fx_rate, fx_rate_date, fx_source, extracted_json
     ) VALUES (?, ?, (SELECT default_category_id FROM suppliers WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    file.id,
    supplierId,
    supplierId,
    status,
    duplicate.reason,
    duplicate.duplicateOfId,
    extracted.documentNumber ?? null,
    documentDate,
    extracted.documentType ?? null,
    currency,
    amountMinor,
    vatAmountMinor,
    ils.amountIlsMinor,
    ils.fxRate,
    ils.fxRateDate,
    ils.fxSource,
    JSON.stringify(extracted),
  );
  await transaction(env.DB, [
    stmt(env.DB, 'UPDATE expense_files SET expense_id = ? WHERE id = ?', lastRowId, file.id),
    auditStatement(env.DB, actor, 'expense.create', 'expense', lastRowId, { status, supplierId, amountMinor }),
  ]);
  return (await first<ExpenseRow>(env.DB, 'SELECT * FROM expenses WHERE id = ?', lastRowId))!;
}

async function downloadForExtraction(env: Env, file: ExpenseFileRow): Promise<ArrayBuffer> {
  const obj = await readFile(env, file.r2_key);
  if (!obj) throw new Error(`File ${file.r2_key} is missing from R2.`);
  return obj.arrayBuffer();
}

/** Ingests one file end to end. Returns null when a Drive file was already ingested before. */
export async function ingestFile(env: Env, deps: Deps, input: IngestInput, actor: AuditActor): Promise<ExpenseRow | null> {
  const file = await recordFile(env, input, actor);
  if (!file) return null;
  return createExpenseFromExtraction(env, deps, file, actor);
}

const DRIVE_ROOT_SETTING_KEY = 'expenses.drive_root_folder_id';

/** The Drive folder id that holds the `YYYY-MM` month folders, or null until the owner sets it. */
export async function getDriveRootFolder(db: D1Database): Promise<string | null> {
  const row = await first<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', DRIVE_ROOT_SETTING_KEY);
  return row?.value ?? null;
}

export async function setDriveRootFolder(db: D1Database, folderId: string, actor: AuditActor): Promise<void> {
  await transaction(db, [
    stmt(
      db,
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = ?`,
      DRIVE_ROOT_SETTING_KEY,
      folderId,
      nowIso(),
    ),
    auditStatement(db, actor, 'settings.update', 'settings', DRIVE_ROOT_SETTING_KEY, { folderId }),
  ]);
}

// ---------------------------------------------------------------------------
// Review: status transitions and edits
// ---------------------------------------------------------------------------

export async function getExpense(db: D1Database, id: number): Promise<ExpenseRow> {
  const row = await first<ExpenseRow>(db, 'SELECT * FROM expenses WHERE id = ?', id);
  if (!row) throw new NotFoundError('Expense', id);
  return row;
}

export async function getExpenseFile(db: D1Database, id: number): Promise<ExpenseFileRow> {
  const row = await first<ExpenseFileRow>(db, 'SELECT * FROM expense_files WHERE id = ?', id);
  if (!row) throw new NotFoundError('File', id);
  return row;
}

export interface ListFilter {
  status?: ExpenseStatus;
  categoryId?: number;
  supplierId?: number;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export async function listExpenses(db: D1Database, filter: ListFilter): Promise<ExpenseRow[]> {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter.status) {
    clauses.push('e.status = ?');
    params.push(filter.status);
  }
  if (filter.categoryId) {
    clauses.push('e.category_id = ?');
    params.push(filter.categoryId);
  }
  if (filter.supplierId) {
    clauses.push('e.supplier_id = ?');
    params.push(filter.supplierId);
  }
  if (filter.from) {
    clauses.push('e.document_date >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push('e.document_date <= ?');
    params.push(filter.to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  params.push(limit, offset);
  return all<ExpenseRow>(db, `SELECT e.*, s.name AS supplier_name, s.tax_id AS supplier_tax_id, c.name_en AS category_name FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id LEFT JOIN expense_categories c ON c.id = e.category_id ${where} ORDER BY e.document_date DESC, e.id DESC LIMIT ? OFFSET ?`, ...params);
}

/** The next expense awaiting review, for the review screen's auto-advance. */
export async function nextForReview(db: D1Database, excludeId?: number): Promise<ExpenseRow | null> {
  return first<ExpenseRow>(
    db,
    `SELECT * FROM expenses WHERE status = 'new' AND id != ? ORDER BY document_date, id LIMIT 1`,
    excludeId ?? 0,
  );
}

export async function setStatus(db: D1Database, id: number, update: StatusUpdate, actor: AuditActor): Promise<ExpenseRow> {
  await getExpense(db, id);
  const reason = update.status === 'returned' ? update.reason! : (update.reason ?? null);
  await transaction(db, [
    stmt(
      db,
      `UPDATE expenses SET status = ?, status_reason = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?`,
      update.status,
      reason,
      nowIso(),
      actor.userId,
      nowIso(),
      id,
    ),
    auditStatement(db, actor, 'expense.status', 'expense', id, { status: update.status, reason }),
  ]);
  return getExpense(db, id);
}

/** Full edit, owner only (runs/R09-accountant.md restricts the accountant to status, category and notes). */
export async function updateExpense(db: D1Database, deps: Pick<Deps, 'fx'>, id: number, update: ExpenseUpdate, actor: AuditActor): Promise<ExpenseRow> {
  const existing = await getExpense(db, id);
  const currency = assertCurrency(update.currency ?? existing.currency);
  const amountMinor = update.amount !== undefined ? parseMajor(update.amount, currency) : existing.amount_minor;
  const vatAmountMinor =
    update.vatAmount !== undefined ? (update.vatAmount === null ? 0 : parseMajor(update.vatAmount, currency)) : existing.vat_amount_minor;
  const documentDate = update.documentDate ?? existing.document_date ?? new Date().toISOString().slice(0, 10);

  const amountChanged = amountMinor !== existing.amount_minor || currency !== existing.currency || documentDate !== existing.document_date;
  const ils = update.fxRateOverride
    ? convertWithRate(amountMinor, update.fxRateOverride)
    : amountChanged
      ? await convertToIls(deps.fx, currency, documentDate, amountMinor)
      : { amountIlsMinor: existing.amount_ils_minor, fxRate: existing.fx_rate, fxRateDate: existing.fx_rate_date, fxSource: existing.fx_source };

  await transaction(db, [
    stmt(
      db,
      `UPDATE expenses SET
         supplier_id = ?, category_id = ?, document_number = ?, document_date = ?, document_type = ?,
         currency = ?, amount_minor = ?, vat_amount_minor = ?, amount_ils_minor = ?, fx_rate = ?, fx_rate_date = ?, fx_source = ?,
         notes = ?, updated_at = ?
       WHERE id = ?`,
      update.supplierId !== undefined ? update.supplierId : existing.supplier_id,
      update.categoryId !== undefined ? update.categoryId : existing.category_id,
      update.documentNumber !== undefined ? update.documentNumber : existing.document_number,
      documentDate,
      update.documentType !== undefined ? update.documentType : existing.document_type,
      currency,
      amountMinor,
      vatAmountMinor,
      ils.amountIlsMinor,
      ils.fxRate,
      ils.fxRateDate,
      ils.fxSource,
      update.notes !== undefined ? update.notes : existing.notes,
      nowIso(),
      id,
    ),
    auditStatement(db, actor, 'expense.update', 'expense', id, update),
  ]);
  return getExpense(db, id);
}

export async function updateExpenseCategoryAndNotes(
  db: D1Database,
  id: number,
  update: { categoryId?: number | null; notes?: string | null },
  actor: AuditActor,
): Promise<ExpenseRow> {
  const existing = await getExpense(db, id);
  await transaction(db, [
    stmt(
      db,
      'UPDATE expenses SET category_id = ?, notes = ?, updated_at = ? WHERE id = ?',
      update.categoryId !== undefined ? update.categoryId : existing.category_id,
      update.notes !== undefined ? update.notes : existing.notes,
      nowIso(),
      id,
    ),
    auditStatement(db, actor, 'expense.update', 'expense', id, update),
  ]);
  return getExpense(db, id);
}

export function formatAmount(minor: number, currency: string): string {
  return formatMinor(minor, assertCurrency(currency));
}
