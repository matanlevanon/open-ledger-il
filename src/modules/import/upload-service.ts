import { type AuditActor, auditStatement } from '../../core/audit';
import { all, first, nowIso, run, stmt, transaction } from '../../core/db';
import { ConflictError, NotFoundError } from '../../core/errors';
import { HOME_CURRENCY, assertCurrency, parseMajor } from '../../core/money';
import type { RateSource } from '../fx';
import { toIlsMinor } from '../fx';
import { sha256Hex } from '../pdf';
import { externalIsIncomeSql, externalSignSql } from './external-kind';
import type { ExternalDocExtractInput, ExternalDocExtractor } from './upload-extractor';
import { EMPTY_EXTRACTION, type ExternalDocumentRow, type ExternalDocumentUploadRow, type ExtractedExternalDoc, type FileExternalDocInput, type UpdateExternalDocInput } from './upload-types';

export interface UploadDeps {
  extractor: ExternalDocExtractor;
  fx: RateSource;
  files: R2Bucket;
}

export interface UploadResult {
  uploadId: number;
  extraction: ExtractedExternalDoc;
  extractionError: string | null;
}

/** R17 task 7: stores the file in R2, runs extraction (best-effort), and stages it for review. */
export async function uploadExternalDocument(
  db: D1Database,
  files: R2Bucket,
  extractor: ExternalDocExtractor,
  actor: AuditActor,
  input: ExternalDocExtractInput,
): Promise<UploadResult> {
  const sha256 = await sha256Hex(input.bytes);
  const key = `external-documents/${sha256}.pdf`;
  await files.put(key, input.bytes, { httpMetadata: { contentType: input.contentType } });

  let extraction: ExtractedExternalDoc = EMPTY_EXTRACTION;
  let extractionError: string | null = null;
  try {
    extraction = await extractor.extract(input);
  } catch (err) {
    extractionError = err instanceof Error ? err.message : String(err);
  }

  const { lastRowId: uploadId } = await run(
    db,
    `INSERT INTO external_document_uploads (r2_key, sha256, filename, content_type, extracted_json, extraction_error, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    key,
    sha256,
    input.filename,
    input.contentType,
    JSON.stringify(extraction),
    extractionError,
    actor.userId,
  );
  return { uploadId, extraction, extractionError };
}

async function getUpload(db: D1Database, id: number): Promise<ExternalDocumentUploadRow> {
  const row = await first<ExternalDocumentUploadRow>(db, 'SELECT * FROM external_document_uploads WHERE id = ?', id);
  if (!row) throw new NotFoundError('Upload', id);
  return row;
}

/**
 * The filed document with the same source, type and number, if any. Types are compared without
 * case or surrounding spaces, so "Payment Request" and "payment request " are the same type, while
 * quote 1000 and payment request 1000 are two different documents.
 */
export async function findDuplicate(db: D1Database, source: string, documentType: string, originalNumber: string): Promise<ExternalDocumentRow | null> {
  return first<ExternalDocumentRow>(
    db,
    'SELECT * FROM external_documents WHERE source = ? AND lower(trim(doc_type)) = lower(trim(?)) AND original_number = ?',
    source,
    documentType,
    originalNumber,
  );
}

/**
 * Confirms or corrects the review screen's fields, matches the document to `clientId` (already
 * resolved by the caller, which matches or creates the client through the ordinary /clients API),
 * and files it: from this point the row is immutable (migrations/1704's triggers).
 */
export async function fileExternalDocument(
  db: D1Database,
  fx: RateSource,
  actor: AuditActor,
  input: FileExternalDocInput,
): Promise<ExternalDocumentRow> {
  const upload = await getUpload(db, input.uploadId);
  if (upload.filed_document_id !== null) conflict('already_filed', 'This upload was already filed.');

  const existing = await findDuplicate(db, input.source, input.documentType, input.originalNumber);
  if (existing) conflict('duplicate_external_document', `${input.documentType} ${input.originalNumber} is already filed.`);

  const currency = assertCurrency(input.currency);
  const amountBeforeVatMinor = parseMajor(input.amountBeforeVat, currency);
  const vatAmountMinor = parseMajor(input.vatAmount, currency);
  const totalMinor = parseMajor(input.total, currency);

  let totalIlsMinor: number | null = null;
  let fxRate: string | null = null;
  let fxRateDate: string | null = null;
  if (currency === HOME_CURRENCY) {
    totalIlsMinor = totalMinor;
  } else {
    try {
      const resolved = await fx.rateFor(currency, input.issueDate);
      fxRate = resolved.rate;
      fxRateDate = resolved.rateDate;
      totalIlsMinor = toIlsMinor(totalMinor, resolved);
    } catch {
      // No rate could be resolved (docs/currency-and-fx.md style fallback); the row still files,
      // just excluded from ILS totals (income reports, the ceiling meter) until corrected.
    }
  }

  const results = await transaction(db, [
    stmt(
      db,
      `INSERT INTO external_documents (source, original_number, doc_type, issue_date, client_id, client_name_text, client_tax_id,
         currency, amount_before_vat_minor, vat_amount_minor, total_minor, total_ils_minor, fx_rate, fx_rate_date, paid_status,
         r2_key, sha256, upload_id, filed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.source,
      input.originalNumber,
      input.documentType,
      input.issueDate,
      input.clientId,
      input.clientName,
      input.clientTaxId,
      currency,
      amountBeforeVatMinor,
      vatAmountMinor,
      totalMinor,
      totalIlsMinor,
      fxRate,
      fxRateDate,
      input.paidStatus,
      upload.r2_key,
      upload.sha256,
      upload.id,
      actor.userId,
    ),
    auditStatement(db, actor, 'external_document.file', 'external_document', null, { source: input.source, originalNumber: input.originalNumber }),
  ]);
  const id = results[0]!.meta.last_row_id;
  await run(db, 'UPDATE external_document_uploads SET filed_document_id = ? WHERE id = ?', id, upload.id);
  const row = await first<ExternalDocumentRow>(db, 'SELECT * FROM external_documents WHERE id = ?', id);
  if (!row) throw new NotFoundError('External document', id);
  return row;
}

function conflict(code: string, message: string): never {
  throw new ConflictError(code, message);
}

export interface ExternalDocFilter {
  clientId?: number;
  from?: string;
  to?: string;
}

export async function listExternalDocuments(db: D1Database, filter: ExternalDocFilter = {}): Promise<ExternalDocumentRow[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.clientId) {
    where.push('client_id = ?');
    params.push(filter.clientId);
  }
  if (filter.from) {
    where.push('issue_date >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    where.push('issue_date <= ?');
    params.push(filter.to);
  }
  return all<ExternalDocumentRow>(
    db,
    `SELECT x.*, (
         SELECT json_object('id', d.id, 'type', d.type, 'number', d.number, 'status', d.status)
         FROM external_document_receipts r JOIN documents d ON d.id = r.document_id
         WHERE r.external_id = x.id AND d.status <> 'cancelled' ORDER BY (d.status = 'final') DESC, d.id DESC LIMIT 1
       ) AS receipt_json
     FROM external_documents x ${where.length ? `WHERE ${where.map((w) => `x.${w}`).join(' AND ')}` : ''} ORDER BY x.issue_date, x.id`,
    ...params,
  );
}

export async function getExternalDocument(db: D1Database, id: number): Promise<ExternalDocumentRow> {
  const row = await first<ExternalDocumentRow>(db, 'SELECT * FROM external_documents WHERE id = ?', id);
  if (!row) throw new NotFoundError('External document', id);
  return row;
}

/** Turnover from uploaded external documents in a date range (R17 task 7: the ceiling meter and income reports). */
export async function externalTurnoverIls(db: D1Database, from: string, to: string): Promise<number> {
  const row = await first<{ total: number | null }>(
    db,
    // Turnover is receipts and invoices. A quote, payment request or pro forma is paid by a receipt.
    `SELECT SUM(${externalSignSql('doc_type')} * total_ils_minor) AS total FROM external_documents
     WHERE issue_date BETWEEN ? AND ? AND ${externalIsIncomeSql('doc_type')}`,
    from,
    to,
  );
  return row?.total ?? 0;
}

/** Converts a total to ILS at the Bank of Israel rate for the date, the way filing does. */
async function ilsFor(fx: RateSource, currency: string, totalMinor: number, date: string) {
  if (currency === HOME_CURRENCY) return { totalIlsMinor: totalMinor, fxRate: null as string | null, fxRateDate: null as string | null };
  try {
    const resolved = await fx.rateFor(currency as Parameters<RateSource['rateFor']>[0], date);
    return { totalIlsMinor: toIlsMinor(totalMinor, resolved), fxRate: resolved.rate as string | null, fxRateDate: resolved.rateDate as string | null };
  } catch {
    return { totalIlsMinor: null, fxRate: null, fxRateDate: null };
  }
}

/**
 * Corrects the fields of a filed past document (read wrong from the PDF, or paid since). The PDF
 * and its source stay as filed (migrations/2240). The ILS total follows a changed date, currency
 * or total. Every change is audited with the old and new values.
 */
export async function updateExternalDocument(
  db: D1Database,
  fx: RateSource,
  actor: AuditActor,
  id: number,
  patch: UpdateExternalDocInput,
): Promise<ExternalDocumentRow> {
  const before = await first<ExternalDocumentRow>(db, 'SELECT * FROM external_documents WHERE id = ?', id);
  if (!before) throw new NotFoundError('External document', id);
  const docType = patch.documentType ?? before.doc_type;
  const originalNumber = patch.originalNumber ?? before.original_number;
  const duplicate = await findDuplicate(db, before.source, docType, originalNumber);
  if (duplicate && duplicate.id !== id) conflict('duplicate_external_document', `${docType} ${originalNumber} is already filed.`);

  if (patch.itemId) {
    const item = await first<{ id: number }>(db, 'SELECT id FROM items WHERE id = ?', patch.itemId);
    if (!item) throw new NotFoundError('Service', patch.itemId);
  }
  const currency = assertCurrency(patch.currency ?? before.currency);
  const issueDate = patch.issueDate ?? before.issue_date;
  const amountBeforeVatMinor = patch.amountBeforeVat !== undefined ? parseMajor(patch.amountBeforeVat, currency) : before.amount_before_vat_minor;
  const vatAmountMinor = patch.vatAmount !== undefined ? parseMajor(patch.vatAmount, currency) : before.vat_amount_minor;
  const totalMinor = patch.total !== undefined ? parseMajor(patch.total, currency) : before.total_minor;
  const ils =
    currency !== before.currency || issueDate !== before.issue_date || totalMinor !== before.total_minor
      ? await ilsFor(fx, currency, totalMinor, issueDate)
      : { totalIlsMinor: before.total_ils_minor, fxRate: before.fx_rate, fxRateDate: before.fx_rate_date };

  const after = {
    doc_type: docType,
    original_number: originalNumber,
    issue_date: issueDate,
    client_id: patch.clientId !== undefined ? patch.clientId : before.client_id,
    client_name_text: patch.clientName ?? before.client_name_text,
    client_tax_id: patch.clientTaxId !== undefined ? patch.clientTaxId : before.client_tax_id,
    currency,
    amount_before_vat_minor: amountBeforeVatMinor,
    vat_amount_minor: vatAmountMinor,
    total_minor: totalMinor,
    total_ils_minor: ils.totalIlsMinor,
    fx_rate: ils.fxRate,
    fx_rate_date: ils.fxRateDate,
    paid_status: patch.paidStatus ?? before.paid_status,
    item_id: patch.itemId !== undefined ? patch.itemId : before.item_id,
  };
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(after)) {
    const old = (before as unknown as Record<string, unknown>)[k];
    if (old !== v) changed[k] = { from: old, to: v };
  }
  if (Object.keys(changed).length > 0) {
    const cols = Object.keys(after);
    await transaction(db, [
      stmt(db, `UPDATE external_documents SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...(Object.values(after) as (string | number | null)[]), id),
      auditStatement(db, actor, 'external_document.update', 'external_document', id, changed),
    ]);
  }
  const row = await first<ExternalDocumentRow>(db, 'SELECT * FROM external_documents WHERE id = ?', id);
  return row!;
}

/** Records that a receipt in this ledger pays an imported past document (see migrations/2240). */
export async function linkReceipt(db: D1Database, actor: AuditActor, externalId: number, documentId: number): Promise<void> {
  const ext = await first<{ id: number }>(db, 'SELECT id FROM external_documents WHERE id = ?', externalId);
  if (!ext) throw new NotFoundError('External document', externalId);
  const doc = await first<{ id: number }>(db, 'SELECT id FROM documents WHERE id = ?', documentId);
  if (!doc) throw new NotFoundError('Document', documentId);
  await transaction(db, [
    stmt(db, 'INSERT OR IGNORE INTO external_document_receipts (external_id, document_id) VALUES (?, ?)', externalId, documentId),
    auditStatement(db, actor, 'external_document.link_receipt', 'external_document', externalId, { documentId }),
  ]);
}
