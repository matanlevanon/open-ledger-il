import { first, run } from '../../core/db';
import { ConfigError, ConflictError, DomainError, NotFoundError, ValidationError } from '../../core/errors';
import { loadDocument } from '../../core/hashchain';
import { assertCurrency } from '../../core/money';
import { getPaymentMethods, parseMethodIds } from '../payment-methods';
import { ALLOCATION_STATUSES } from '../ita/documents';
import { type AllocationGate, allocationGate } from '../ita/gate';
import { signPdf } from '../signing';
import type { SigningIdentity } from '../signing';
import type { PdfEngine } from './engine';
import { renderDocument } from './render';
import { imageDataUri } from './signature-image';
import type { PaymentMethod, RenderClient, RenderDocument, RenderPaymentMethod, RenderSource, RenderVariant } from './types';

interface PdfHashEntry {
  variant: RenderVariant;
  sha256: string;
  at: string;
}

function parsePdfHashes(raw: unknown): PdfHashEntry[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? (parsed as PdfHashEntry[]) : [];
}

interface ClientRow {
  name_en: string;
  name_he: string | null;
  company_id: string | null;
  vat_number: string | null;
  country: string;
  foreign_resident: number;
  address_en: string | null;
  address_he: string | null;
}

interface BusinessRow {
  name_en: string;
  name_he: string;
  tagline_en: string | null;
  tagline_he: string | null;
  address_en: string | null;
  address_he: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  bank_details: string | null;
  payment_method_ids: string | null;
  tax_id: string | null;
  logo_r2_key: string | null;
  signature_r2_key: string | null;
}

interface SeriesRow {
  name_en: string;
  name_he: string | null;
}

interface TypeRow {
  kind: string;
}

interface SourceRow {
  type: string;
  number: number | null;
  type_name_en: string;
  type_name_he: string | null;
}

async function fetchKind(db: D1Database, typeCode: string): Promise<string> {
  const row = await first<TypeRow>(db, 'SELECT kind FROM document_types WHERE code = ?', typeCode);
  return row?.kind ?? '';
}

async function fetchClient(db: D1Database, clientId: number | null): Promise<RenderClient | null> {
  if (clientId === null) return null;
  const row = await first<ClientRow>(db, 'SELECT * FROM clients WHERE id = ?', clientId);
  if (!row) throw new NotFoundError('Client', clientId);
  return {
    nameEn: row.name_en,
    nameHe: row.name_he,
    companyId: row.company_id,
    vatNumber: row.vat_number,
    country: row.country,
    foreignResident: row.foreign_resident === 1,
    addressEn: row.address_en,
    addressHe: row.address_he,
  };
}

async function fetchBusiness(db: D1Database, taxId: string | null, files: R2Bucket | null | undefined) {
  const row = await first<BusinessRow>(db, 'SELECT * FROM business_profile WHERE id = 1');
  if (!row) throw new ConfigError('Business profile is not set up.');
  return {
    nameEn: row.name_en,
    nameHe: row.name_he,
    taglineEn: row.tagline_en,
    taglineHe: row.tagline_he,
    addressEn: row.address_en,
    addressHe: row.address_he,
    email: row.email,
    phone: row.phone,
    website: row.website,
    bankDetails: row.bank_details,
    taxId: row.tax_id?.trim() || taxId,
    logoDataUri: await imageDataUri(files, row.logo_r2_key),
    signatureDataUri: await imageDataUri(files, row.signature_r2_key),
  };
}

async function fetchSeries(db: D1Database, seriesId: string): Promise<SeriesRow> {
  const row = await first<SeriesRow>(db, 'SELECT name_en, name_he FROM series WHERE id = ?', seriesId);
  if (!row) throw new NotFoundError('Series', seriesId);
  return row;
}

/** The document this one was created from, when linked (R17 task 6's "Created from:" line). */
async function fetchSource(db: D1Database, sourceId: number | null | undefined): Promise<RenderSource | null> {
  if (!sourceId) return null;
  const row = await first<SourceRow>(
    db,
    `SELECT d.type, d.number, dt.name_en AS type_name_en, dt.name_he AS type_name_he
     FROM documents d JOIN document_types dt ON dt.code = d.type WHERE d.id = ?`,
    sourceId,
  );
  if (!row) return null;
  return { typeNameEn: row.type_name_en, typeNameHe: row.type_name_he ?? row.type_name_en, number: row.number };
}

function toRenderPaymentMethod(row: { display_name: string; type: string; details: string }): RenderPaymentMethod {
  return {
    displayName: row.display_name,
    type: row.type as RenderPaymentMethod['type'],
    details: JSON.parse(row.details) as Record<string, string | null>,
  };
}

/** Resolves a document or business's `payment_method_ids` JSON column into full catalog rows, in the order given. */
async function fetchPaymentMethods(db: D1Database, rawIds: string | null): Promise<RenderPaymentMethod[]> {
  const ids = parseMethodIds(rawIds);
  if (ids.length === 0) return [];
  const rows = await getPaymentMethods(db, ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r) => r !== undefined).map(toRenderPaymentMethod);
}

export interface LoadRenderDocumentOptions {
  /** OWNER_TAX_ID secret, the fallback when Settings > Business has no tax id. Never logged. */
  ownerTaxId: string | null;
  /** R2 bucket with the uploaded logo and signature. Without it the PDF prints the default logo and no signature. */
  files?: R2Bucket | null;
}

/** Builds a `RenderDocument` from the database for one document and variant. */
export async function loadRenderDocument(
  db: D1Database,
  documentId: number,
  variant: RenderVariant,
  options: LoadRenderDocumentOptions,
): Promise<RenderDocument> {
  const loaded = await loadDocument(db, documentId);
  if (!loaded) throw new NotFoundError('Document', documentId);
  const row = loaded.row as Record<string, unknown>;

  const meta = await first<{ source_id: number | null }>(db, 'SELECT source_id FROM document_meta WHERE document_id = ?', documentId);

  const [client, series, business, kind, source, paymentMethods] = await Promise.all([
    fetchClient(db, row.client_id === null || row.client_id === undefined ? null : Number(row.client_id)),
    fetchSeries(db, String(row.series_id)),
    fetchBusiness(db, options.ownerTaxId, options.files),
    fetchKind(db, String(row.type)),
    fetchSource(db, meta?.source_id ?? null),
    fetchPaymentMethods(db, (row.payment_method_ids as string | null) ?? null),
  ]);

  const legalMode = row.legal_mode === 'murshe' ? 'murshe' : 'patur';
  const currency = assertCurrency(row.currency);

  const existingHashes = parsePdfHashes(row.pdf_hashes);
  const isOriginal = !existingHashes.some((h) => h.variant === variant);
  const gate = await allocationGate(db, documentId);

  const paymentRows = loaded.payments as unknown as { method_id: number | null }[];
  const paymentMethodIds = [...new Set(paymentRows.map((p) => p.method_id).filter((id): id is number => id !== null))];
  const paymentMethodById = new Map(
    (await getPaymentMethods(db, paymentMethodIds)).map((r) => [r.id, toRenderPaymentMethod(r)]),
  );

  return {
    id: Number(row.id),
    seriesId: String(row.series_id),
    type: String(row.type),
    typeNameEn: series.name_en,
    typeNameHe: series.name_he ?? series.name_en,
    kind,
    number: row.number === null || row.number === undefined ? null : Number(row.number),
    status: String(row.status),
    legalMode,
    langVariant: row.lang_variant === 'bilingual' ? 'bilingual' : 'en',
    date: String(row.date),
    issuanceDate: (row.issuance_date as string | null) ?? null,
    currency,
    fxRate: (row.fx_rate as string | null) ?? null,
    fxRateDate: (row.fx_rate_date as string | null) ?? null,
    fxRateLabel: null,
    subtotalMinor: Number(row.subtotal_minor),
    vatRateBp: row.vat_rate_bp === null || row.vat_rate_bp === undefined ? null : Number(row.vat_rate_bp),
    vatAmountMinor: Number(row.vat_amount_minor),
    totalMinor: Number(row.total_minor),
    totalIlsMinor: row.total_ils_minor === null || row.total_ils_minor === undefined ? null : Number(row.total_ils_minor),
    allocationNumber: (row.allocation_number as string | null) ?? null,
    printNote: gate.print_note,
    notes: (row.notes as string | null) ?? null,
    paymentInstructions: (row.payment_instructions as string | null) ?? null,
    paymentMethods,
    isOriginal,
    source,
    lines: loaded.lines
      .slice()
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map((l) => ({
        position: Number(l.position),
        descriptionEn: String(l.description_en),
        descriptionHe: (l.description_he as string | null) ?? null,
        detailEn: (l.detail_en as string | null) ?? null,
        detailHe: (l.detail_he as string | null) ?? null,
        quantityMilli: Number(l.quantity_milli),
        unitPriceMinor: Number(l.unit_price_minor),
        discountMinor: Number(l.discount_minor),
        lineTotalMinor: Number(l.line_total_minor),
      })),
    payments: loaded.payments.map((p) => ({
      method: p.method as PaymentMethod,
      methodDetail: p.method_id !== null && p.method_id !== undefined ? (paymentMethodById.get(Number(p.method_id)) ?? null) : null,
      paidOn: String(p.paid_on),
      reference: (p.reference as string | null) ?? null,
      amountMinor: Number(p.amount_minor),
      amountIlsMinor: p.amount_ils_minor === null || p.amount_ils_minor === undefined ? null : Number(p.amount_ils_minor),
      currency: assertCurrency(p.currency),
    })),
    client,
    business,
  };
}

/** Whether a copy of this variant was already rendered and stored in R2 (R16 task 4). */
export async function hasStoredPdf(db: D1Database, documentId: number, variant: RenderVariant): Promise<boolean> {
  const row = await first<{ pdf_hashes: string | null }>(db, 'SELECT pdf_hashes FROM documents WHERE id = ?', documentId);
  if (!row) throw new NotFoundError('Document', documentId);
  return parsePdfHashes(row.pdf_hashes).some((h) => h.variant === variant);
}

export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** R2 key per R02: docs/<year>/<series>/<number>-<variant>.pdf. */
export function r2Key(date: string, seriesId: string, number: number, variant: RenderVariant): string {
  const year = date.slice(0, 4);
  return `docs/${year}/${seriesId}/${number}-${variant}.pdf`;
}

/**
 * The "Download" button's filename (R17 task 3): "<type>-<number>-<client>.pdf", for example
 * "PR-0088-Acme-Ltd.pdf". Strips characters a filesystem or a browser might choke on.
 */
export function downloadFilename(doc: RenderDocument): string {
  const number = doc.number === null ? 'draft' : String(doc.number).padStart(4, '0');
  const client = (doc.client?.nameEn ?? 'client')
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${doc.type}-${number}-${client || 'client'}.pdf`;
}

export interface RenderAndStoreResult {
  key: string;
  sha256: string;
  html: string;
  bytes: Uint8Array;
}

const GATE_MESSAGES: Record<AllocationGate['reason'], string> = {
  not_requested: '',
  number_granted: '',
  decision_continue: '',
  waiting_for_number: 'This tax invoice is waiting for its ITA allocation number. The client copy can leave once the number arrives.',
  waiting_for_choice: 'The ITA refused an allocation number. Record your decision, then create the client copy.',
  cancelled: 'This document is cancelled. Its client copy cannot leave the system.',
};

/**
 * CLAUDE.md rule 3: no PDF of a qualifying tax invoice leaves the system before an allocation
 * number or a recorded refusal decision. R12's `allocationGate` is the one rule. The filed copy
 * is the internal audit record and is always allowed. Only the client copy, the one that can
 * leave the system, is gated. Returns the gate for the client copy, null for the filed copy.
 */
export async function assertClientCopyMayRelease(
  db: D1Database,
  documentId: number,
  variant: RenderVariant,
): Promise<AllocationGate | null> {
  if (variant !== 'client') return null;
  const gate = await allocationGate(db, documentId);
  if (gate.allowed) return gate;
  throw new DomainError('allocation_required', GATE_MESSAGES[gate.reason], 409, { reason: gate.reason });
}

/**
 * Renders a draft to PDF for the "Show document" preview (R16 task 3): no number, no signature,
 * a diagonal DRAFT stamp (`renderDocument` adds it whenever `doc.status === 'draft'`). Never
 * stored in R2 and never signed, so a draft preview cannot be mistaken for the issued document.
 */
export async function renderDraftPdf(
  db: D1Database,
  engine: PdfEngine,
  documentId: number,
  variant: RenderVariant,
  options: LoadRenderDocumentOptions,
): Promise<ArrayBuffer> {
  const doc = await loadRenderDocument(db, documentId, variant, options);
  if (doc.status !== 'draft') {
    throw new ValidationError('This preview is for drafts. Use "View client copy" or "View filed copy" for a finalized document.');
  }
  const html = renderDocument(doc, variant);
  return engine.renderPdf(html);
}

/**
 * Renders a finalized document to PDF, signs it (PAdES-B, R03) when a signing identity is given,
 * stores it in R2 and appends its hash to `documents.pdf_hashes`. Pass `signing` from
 * `resolveSigningIdentity` (`./signing.ts`); `null` stores the PDF unsigned.
 */
export async function renderAndStore(
  db: D1Database,
  files: R2Bucket,
  engine: PdfEngine,
  documentId: number,
  variant: RenderVariant,
  options: LoadRenderDocumentOptions,
  signing: SigningIdentity | null = null,
): Promise<RenderAndStoreResult> {
  const doc = await loadRenderDocument(db, documentId, variant, { ...options, files: options.files ?? files });
  const numberedStatuses: readonly string[] = ['final', 'cancelled', ...ALLOCATION_STATUSES];
  if (doc.number === null || !numberedStatuses.includes(doc.status)) {
    throw new ValidationError('Only a finalized document can be stored as a PDF.');
  }
  await assertClientCopyMayRelease(db, documentId, variant);

  const html = renderDocument({ ...doc, signed: signing !== null }, variant);
  const rendered = await engine.renderPdf(html);
  const bytes = signing
    ? await signPdf(new Uint8Array(rendered), { ...signing, signerName: doc.business.nameEn || undefined })
    : new Uint8Array(rendered);
  const sha256 = await sha256Hex(bytes);
  const key = r2Key(doc.date, doc.seriesId, doc.number, variant);

  await files.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });

  const current = await first<{ pdf_hashes: string | null; updated_at: string }>(
    db,
    'SELECT pdf_hashes, updated_at FROM documents WHERE id = ?',
    documentId,
  );
  if (!current) throw new NotFoundError('Document', documentId);
  const entries = parsePdfHashes(current.pdf_hashes);
  entries.push({ variant, sha256, at: new Date().toISOString() });
  const result = await run(
    db,
    'UPDATE documents SET pdf_hashes = ?, updated_at = ? WHERE id = ? AND pdf_hashes IS ?',
    JSON.stringify(entries),
    new Date().toISOString(),
    documentId,
    current.pdf_hashes,
  );
  if (result.changes !== 1) {
    throw new ConflictError('pdf_hashes_conflict', 'Another PDF was stored for this document at the same time. Try again.');
  }

  return { key, sha256, html, bytes };
}
