import { type AuditActor, auditStatement, systemActorFor } from '../../core/audit';
import { all, first, nowIso, stmt, transaction } from '../../core/db';
import { NotFoundError, UnauthorizedError, ValidationError } from '../../core/errors';
import type { Env } from '../../env';
import { isValidIsraeliId } from '../ops/israeli-id';
import { signSendToken, verifySendToken } from '../sending/tokens';
import type { BusinessDocumentReader } from './reader';
import {
  ALLOWED_CONTENT_TYPES,
  type AllowedContentType,
  type BusinessDocumentLinkRow,
  type BusinessDocumentRow,
  type BusinessDocumentType,
  BUSINESS_DOCUMENT_TYPES,
  EXPIRING_TYPES,
  EXPIRY_WARNING_DAYS,
  type ExtractedBusinessDocument,
  MAX_BYTES,
  SHARE_DAYS,
  TYPE_LABELS,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** R2 key: content-addressed per business, so the same bytes are stored once (write-once bucket). */
export function businessDocumentKey(businessId: number, sha256: string, contentType: AllowedContentType): string {
  return `business/${businessId}/documents/${sha256}.${ALLOWED_CONTENT_TYPES[contentType]}`;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** What the screen shows next to the parsed fields: is the number valid, and is it this business's. */
export interface ExtractionCheck {
  taxIdValid: boolean | null;
  taxIdMatches: boolean | null;
}

export function checkExtraction(extracted: ExtractedBusinessDocument | null, businessTaxId: string | null): ExtractionCheck {
  const taxId = extracted?.taxId?.replace(/\D/g, '') ?? '';
  if (!taxId) return { taxIdValid: null, taxIdMatches: null };
  const ours = (businessTaxId ?? '').replace(/\D/g, '');
  return { taxIdValid: isValidIsraeliId(taxId), taxIdMatches: ours ? taxId.padStart(9, '0') === ours.padStart(9, '0') : null };
}

export interface BusinessDocumentView {
  id: number;
  type: BusinessDocumentType;
  typeLabel: { en: string; he: string };
  fileName: string;
  contentType: string;
  sizeBytes: number;
  issueDate: string | null;
  validUntil: string | null;
  extracted: ExtractedBusinessDocument | null;
  check: ExtractionCheck;
  confirmedAt: string | null;
  current: boolean;
  replacedBy: number | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

async function businessTaxId(db: D1Database, businessId: number): Promise<string | null> {
  return (await first<{ tax_id: string | null }>(db, 'SELECT tax_id FROM businesses WHERE id = ?', businessId))?.tax_id ?? null;
}

function toView(row: BusinessDocumentRow & { uploader: string | null }, taxId: string | null): BusinessDocumentView {
  const extracted = row.extracted_json ? (JSON.parse(row.extracted_json) as ExtractedBusinessDocument) : null;
  return {
    id: row.id,
    type: row.type,
    typeLabel: TYPE_LABELS[row.type],
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    issueDate: row.issue_date,
    validUntil: row.valid_until,
    extracted,
    check: checkExtraction(extracted, taxId),
    confirmedAt: row.confirmed_at,
    current: row.replaced_by === null,
    replacedBy: row.replaced_by,
    uploadedBy: row.uploader,
    uploadedAt: row.uploaded_at,
  };
}

/** Every document of the business, current first, newest first. Replaced ones stay listed. */
export async function listBusinessDocuments(db: D1Database, businessId: number): Promise<BusinessDocumentView[]> {
  const rows = await all<BusinessDocumentRow & { uploader: string | null }>(
    db,
    `SELECT d.*, u.email AS uploader FROM business_documents d LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE d.business_id = ? ORDER BY d.replaced_by IS NOT NULL, d.uploaded_at DESC, d.id DESC`,
    businessId,
  );
  const taxId = await businessTaxId(db, businessId);
  return rows.map((r) => toView(r, taxId));
}

export async function getBusinessDocument(db: D1Database, businessId: number, id: number): Promise<BusinessDocumentRow> {
  const row = await first<BusinessDocumentRow>(db, 'SELECT * FROM business_documents WHERE id = ? AND business_id = ?', id, businessId);
  if (!row) throw new NotFoundError('Business document', id);
  return row;
}

async function viewOf(db: D1Database, businessId: number, id: number): Promise<BusinessDocumentView> {
  const row = await first<BusinessDocumentRow & { uploader: string | null }>(
    db,
    'SELECT d.*, u.email AS uploader FROM business_documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.id = ? AND d.business_id = ?',
    id,
    businessId,
  );
  if (!row) throw new NotFoundError('Business document', id);
  return toView(row, await businessTaxId(db, businessId));
}

const isoDate = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined || v === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ValidationError('Use a date like 2026-12-31.');
  return v;
};

export interface UploadInput {
  businessId: number;
  type: string;
  fileName: string;
  contentType: string;
  bytes: ArrayBuffer;
  issueDate?: string | null;
  validUntil?: string | null;
}

/**
 * Stores the file write-once, reads it when a reader is set up, and makes it the current document
 * of its type. The older document of that type stays listed as replaced. The same bytes uploaded
 * again for the same type return the current document unchanged.
 */
export async function uploadBusinessDocument(
  env: Env,
  reader: BusinessDocumentReader | null,
  actor: AuditActor,
  input: UploadInput,
): Promise<{ document: BusinessDocumentView; readError: string | null }> {
  const db = env.DB;
  if (!(BUSINESS_DOCUMENT_TYPES as readonly string[]).includes(input.type)) throw new ValidationError('Pick a document type.');
  const type = input.type as BusinessDocumentType;
  if (!(input.contentType in ALLOWED_CONTENT_TYPES)) throw new ValidationError('Upload a PDF, JPG or PNG file.');
  const contentType = input.contentType as AllowedContentType;
  if (input.bytes.byteLength === 0) throw new ValidationError('The file is empty.');
  if (input.bytes.byteLength > MAX_BYTES) throw new ValidationError('The file is larger than 10 MB.');
  const issueDate = isoDate(input.issueDate);
  const validUntil = isoDate(input.validUntil);

  const sha256 = await sha256Hex(input.bytes);
  const current = await first<BusinessDocumentRow>(
    db,
    'SELECT * FROM business_documents WHERE business_id = ? AND type = ? AND replaced_by IS NULL ORDER BY id DESC LIMIT 1',
    input.businessId,
    type,
  );
  if (current && current.sha256 === sha256) return { document: await viewOf(db, input.businessId, current.id), readError: null };

  const key = businessDocumentKey(input.businessId, sha256, contentType);
  // Same key means same bytes. Keep the stored copy: the files bucket refuses overwrites.
  if (!(await env.FILES.head(key))) await env.FILES.put(key, input.bytes, { httpMetadata: { contentType } });

  let extracted: ExtractedBusinessDocument | null = null;
  let readError: string | null = null;
  if (reader) {
    try {
      extracted = await reader.read({ bytes: input.bytes, contentType });
    } catch (err) {
      readError = err instanceof Error ? err.message : 'The document could not be read.';
    }
  }

  const fileName = input.fileName.trim().slice(0, 200) || `${type}.${ALLOWED_CONTENT_TYPES[contentType]}`;
  await transaction(db, [
    stmt(
      db,
      `INSERT INTO business_documents (business_id, type, r2_key, sha256, file_name, content_type, size_bytes, issue_date, valid_until, extracted_json, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.businessId,
      type,
      key,
      sha256,
      fileName,
      contentType,
      input.bytes.byteLength,
      issueDate ?? extracted?.issueDate ?? null,
      validUntil ?? extracted?.validUntil ?? null,
      extracted ? JSON.stringify(extracted) : null,
      actor.userId,
    ),
    // The new row becomes current. The one it replaces keeps its file and its history.
    stmt(
      db,
      `UPDATE business_documents
       SET replaced_by = (SELECT MAX(id) FROM business_documents WHERE business_id = ? AND type = ?)
       WHERE business_id = ? AND type = ? AND replaced_by IS NULL
         AND id < (SELECT MAX(id) FROM business_documents WHERE business_id = ? AND type = ?)`,
      input.businessId,
      type,
      input.businessId,
      type,
      input.businessId,
      type,
    ),
    auditStatement(db, actor, 'business_document.upload', 'business_document', null, {
      type,
      sha256,
      sizeBytes: input.bytes.byteLength,
      replaces: current?.id ?? null,
      read: extracted !== null,
    }),
  ]);
  const created = (await first<{ id: number }>(db, 'SELECT id FROM business_documents WHERE business_id = ? AND sha256 = ? AND type = ? ORDER BY id DESC LIMIT 1', input.businessId, sha256, type))!;
  return { document: await viewOf(db, input.businessId, created.id), readError };
}

/** The owner confirms the dates. After that the row is fixed. A correction is a new upload. */
export async function confirmBusinessDocument(
  db: D1Database,
  actor: AuditActor,
  businessId: number,
  id: number,
  input: { issueDate?: string | null; validUntil?: string | null },
): Promise<BusinessDocumentView> {
  const row = await getBusinessDocument(db, businessId, id);
  if (row.confirmed_at) throw new ValidationError('This document is already confirmed. Upload a new one to change it.');
  if (row.replaced_by !== null) throw new ValidationError('This document was replaced. Confirm the current one.');
  const issueDate = input.issueDate === undefined ? row.issue_date : isoDate(input.issueDate);
  const validUntil = input.validUntil === undefined ? row.valid_until : isoDate(input.validUntil);
  if (issueDate && validUntil && validUntil < issueDate) throw new ValidationError('Valid until is before the issue date.');
  if (EXPIRING_TYPES.includes(row.type) && !validUntil) throw new ValidationError('This certificate ends. Enter the valid-until date.');
  await transaction(db, [
    stmt(db, 'UPDATE business_documents SET issue_date = ?, valid_until = ?, confirmed_at = ? WHERE id = ? AND confirmed_at IS NULL', issueDate, validUntil, nowIso(), id),
    auditStatement(db, actor, 'business_document.confirm', 'business_document', id, { issueDate, validUntil }),
  ]);
  return viewOf(db, businessId, id);
}

/** Opens the file for a signed-in person. Every opening is audited. */
export async function openBusinessDocument(
  env: Env,
  actor: AuditActor,
  businessId: number,
  id: number,
  disposition: 'inline' | 'attachment',
): Promise<{ row: BusinessDocumentRow; object: R2ObjectBody }> {
  const row = await getBusinessDocument(env.DB, businessId, id);
  const object = await env.FILES.get(row.r2_key);
  if (!object) throw new NotFoundError('Business document file', id);
  await transaction(env.DB, [
    auditStatement(env.DB, actor, disposition === 'inline' ? 'business_document.view' : 'business_document.download', 'business_document', id, {
      type: row.type,
    }),
  ]);
  return { row, object };
}

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

export const SHARE_PATH = '/api/sending/public/bd/';

export interface ShareLinkView {
  id: number;
  documentId: number;
  documentType: BusinessDocumentType;
  fileName: string;
  channel: BusinessDocumentLinkRow['channel'];
  sentTo: string | null;
  expiresAt: string;
  createdAt: string;
  createdBy: string | null;
  openCount: number;
  lastOpenedAt: string | null;
}

/** Creates a signed link that expires after 1, 7 or 30 days. The link row makes it revocable. */
export async function createShareLink(
  env: Env,
  actor: AuditActor,
  businessId: number,
  documentId: number,
  input: { days: number; channel: BusinessDocumentLinkRow['channel']; sentTo?: string | null; baseUrl: string; now?: number },
): Promise<{ id: number; url: string; expiresAt: string }> {
  if (!(SHARE_DAYS as readonly number[]).includes(input.days)) throw new ValidationError('A link lasts 1, 7 or 30 days.');
  const row = await getBusinessDocument(env.DB, businessId, documentId);
  const now = input.now ?? Date.now();
  const exp = Math.floor(now / 1000) + input.days * 24 * 60 * 60;
  const expiresAt = new Date(exp * 1000).toISOString();
  const res = await transaction(env.DB, [
    stmt(
      env.DB,
      'INSERT INTO business_document_links (business_id, document_id, expires_at, channel, sent_to, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      businessId,
      row.id,
      expiresAt,
      input.channel,
      input.sentTo ?? null,
      actor.userId,
    ),
    auditStatement(env.DB, actor, 'business_document.share', 'business_document', row.id, { days: input.days, channel: input.channel, sentTo: input.sentTo ?? null }),
  ]);
  const linkId = Number(res[0]!.meta.last_row_id);
  const token = await signSendToken(env, { kind: 'business_document', linkId, exp });
  return { id: linkId, url: `${input.baseUrl}${SHARE_PATH}${token}`, expiresAt };
}

/** Links that still open: not revoked, not expired. */
export async function listActiveLinks(db: D1Database, businessId: number, now = nowIso()): Promise<ShareLinkView[]> {
  const rows = await all<BusinessDocumentLinkRow & { type: BusinessDocumentType; file_name: string; creator: string | null }>(
    db,
    `SELECT l.*, d.type, d.file_name, u.email AS creator FROM business_document_links l
     JOIN business_documents d ON d.id = l.document_id LEFT JOIN users u ON u.id = l.created_by
     WHERE l.business_id = ? AND l.revoked_at IS NULL AND l.expires_at > ? ORDER BY l.created_at DESC, l.id DESC`,
    businessId,
    now,
  );
  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    documentType: r.type,
    fileName: r.file_name,
    channel: r.channel,
    sentTo: r.sent_to,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    createdBy: r.creator,
    openCount: r.open_count,
    lastOpenedAt: r.last_opened_at,
  }));
}

export async function revokeShareLink(db: D1Database, actor: AuditActor, businessId: number, linkId: number): Promise<void> {
  const link = await first<BusinessDocumentLinkRow>(db, 'SELECT * FROM business_document_links WHERE id = ? AND business_id = ?', linkId, businessId);
  if (!link) throw new NotFoundError('Share link', linkId);
  if (link.revoked_at) return;
  await transaction(db, [
    stmt(db, 'UPDATE business_document_links SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL', nowIso(), actor.userId, linkId),
    auditStatement(db, actor, 'business_document.link_revoke', 'business_document_link', linkId, { documentId: link.document_id }),
  ]);
}

/**
 * The public side: whoever holds the link, no Cloudflare Access session. The signature, the
 * expiry and the link row all have to agree. Every opening writes an audit row.
 */
export async function openSharedDocument(
  env: Env,
  token: string,
  request: { ip: string | null; userAgent: string | null },
): Promise<{ row: BusinessDocumentRow; object: R2ObjectBody }> {
  const payload = await verifySendToken(env, token);
  if (payload.kind !== 'business_document') throw new UnauthorizedError('This link is not valid.');
  const link = await first<BusinessDocumentLinkRow>(env.DB, 'SELECT * FROM business_document_links WHERE id = ?', payload.linkId);
  if (!link) throw new UnauthorizedError('This link is not valid.');
  if (link.revoked_at) throw new UnauthorizedError('This link was turned off.');
  const now = nowIso();
  if (link.expires_at <= now) throw new UnauthorizedError('This link has expired.');
  const row = await getBusinessDocument(env.DB, link.business_id, link.document_id);
  const object = await env.FILES.get(row.r2_key);
  if (!object) throw new NotFoundError('Business document file', row.id);
  const actor: AuditActor = { ...systemActorFor(link.business_id), email: 'shared-link', role: 'public', ip: request.ip, userAgent: request.userAgent };
  await transaction(env.DB, [
    stmt(env.DB, 'UPDATE business_document_links SET open_count = open_count + 1, last_opened_at = ? WHERE id = ?', now, link.id),
    auditStatement(env.DB, actor, 'business_document.shared_open', 'business_document', row.id, { linkId: link.id }),
  ]);
  return { row, object };
}

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

export interface ExpiringDocument {
  id: number;
  type: BusinessDocumentType;
  typeLabel: { en: string; he: string };
  validUntil: string;
  daysLeft: number;
}

/** Current certificates that end within 30 days, or already ended. The dashboard line reads this. */
export async function expiringDocuments(db: D1Database, businessId: number, today: string): Promise<ExpiringDocument[]> {
  const rows = await all<{ id: number; type: BusinessDocumentType; valid_until: string }>(
    db,
    `SELECT id, type, valid_until FROM business_documents
     WHERE business_id = ? AND replaced_by IS NULL AND valid_until IS NOT NULL AND valid_until <= ?
       AND type IN (${EXPIRING_TYPES.map(() => '?').join(',')})
     ORDER BY valid_until`,
    businessId,
    addDays(today, EXPIRY_WARNING_DAYS),
    ...EXPIRING_TYPES,
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    typeLabel: TYPE_LABELS[r.type],
    validUntil: r.valid_until,
    daysLeft: Math.round((Date.parse(`${r.valid_until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS),
  }));
}

/**
 * The 07:00 sweep: one task and one Slack alert per certificate, 30 days before it ends. A
 * certificate already alerted is skipped, so a cron that runs twice alerts once.
 */
export async function alertExpiringDocuments(
  db: D1Database,
  businessId: number,
  today: string,
  notifier: { send(text: string): Promise<boolean> },
): Promise<number[]> {
  const due = await expiringDocuments(db, businessId, today);
  const name = (await first<{ name_en: string; name_he: string }>(db, 'SELECT name_en, name_he FROM businesses WHERE id = ?', businessId)) ?? { name_en: '', name_he: '' };
  const label = name.name_en || name.name_he || `Business ${businessId}`;
  const alerted: number[] = [];
  for (const d of due) {
    const row = await first<{ expiry_alerted_at: string | null }>(db, 'SELECT expiry_alerted_at FROM business_documents WHERE id = ?', d.id);
    if (row?.expiry_alerted_at) continue;
    const title = `Renew the ${d.typeLabel.en.toLowerCase()} of ${label}. It ends on ${d.validUntil}.`;
    await transaction(db, [
      stmt(db, "INSERT INTO tasks (kind, title, due_at, business_id) VALUES ('business_document_expiry', ?, ?, ?)", title, d.validUntil, businessId),
      stmt(db, 'UPDATE business_documents SET expiry_alerted_at = ? WHERE id = ? AND expiry_alerted_at IS NULL', nowIso(), d.id),
      auditStatement(db, systemActorFor(businessId), 'business_document.expiry_alert', 'business_document', d.id, { validUntil: d.validUntil }),
    ]);
    await notifier.send(`:warning: ${title}`);
    alerted.push(d.id);
  }
  return alerted;
}
