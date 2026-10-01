import { z } from 'zod';
import { CURRENCY_CODES } from '../../core/money';

export const EXTERNAL_SOURCES = ['sumit', 'wave', 'other'] as const;
export type ExternalSource = (typeof EXTERNAL_SOURCES)[number];

export const PAID_STATUSES = ['paid', 'unpaid', 'unknown'] as const;
export type PaidStatus = (typeof PAID_STATUSES)[number];

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const MONEY_MAJOR = z.string().regex(/^\d+(\.\d{1,6})?$/, 'Use a plain decimal amount, for example 123.45');
/** An exchange rate to the shekel as printed on the document, for example 2.988. */
const RATE = z.string().regex(/^\d+(\.\d{1,6})?$/, 'Use a plain decimal rate, for example 3.65');
const CURRENCY = z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.enum(CURRENCY_CODES as [string, ...string[]]));

/**
 * What the extractor returns for one uploaded file (R17 task 7): source system, document type,
 * original number, issue date, client name, client tax id, currency, amount before VAT, VAT,
 * total and paid status. Every field is nullable since a document may not print all of them, or
 * extraction may run with no ANTHROPIC_API_KEY (empty fields, manual entry).
 */
export const ExtractedExternalDocSchema = z.object({
  source: z.enum(EXTERNAL_SOURCES).nullable(),
  documentType: z.string().trim().min(1).nullable(),
  originalNumber: z.string().trim().min(1).nullable(),
  issueDate: DATE.nullable(),
  clientName: z.string().trim().min(1).nullable(),
  clientTaxId: z.string().trim().min(1).nullable(),
  currency: CURRENCY.nullable(),
  amountBeforeVat: MONEY_MAJOR.nullable(),
  vatAmount: MONEY_MAJOR.nullable(),
  total: MONEY_MAJOR.nullable(),
  /** The exchange rate to the shekel printed on a foreign-currency document. Null when none is printed. */
  exchangeRate: RATE.nullable().catch(null),
  /** The total in shekels printed on a foreign-currency document. Null when none is printed. */
  totalIls: MONEY_MAJOR.nullable().catch(null),
  paidStatus: z.enum(PAID_STATUSES).nullable(),
});
export type ExtractedExternalDoc = z.infer<typeof ExtractedExternalDocSchema>;

export const EMPTY_EXTRACTION: ExtractedExternalDoc = {
  source: null,
  documentType: null,
  originalNumber: null,
  issueDate: null,
  clientName: null,
  clientTaxId: null,
  currency: null,
  amountBeforeVat: null,
  vatAmount: null,
  total: null,
  exchangeRate: null,
  totalIls: null,
  paidStatus: null,
};

/** The review screen's confirm/correct submission (R17 task 7). */
export const FileExternalDocSchema = z.object({
  uploadId: z.number().int().positive(),
  source: z.enum(EXTERNAL_SOURCES),
  documentType: z.string().trim().min(1),
  originalNumber: z.string().trim().min(1),
  issueDate: DATE,
  clientId: z.number().int().positive().nullable(),
  clientName: z.string().trim().min(1),
  clientTaxId: z.string().trim().min(1).nullable(),
  currency: CURRENCY,
  amountBeforeVat: MONEY_MAJOR,
  vatAmount: MONEY_MAJOR,
  total: MONEY_MAJOR,
  /**
   * The rate and shekel total printed on a foreign-currency document. The Ledger never assumes a
   * rate: without either one the document files with no shekel amount until you add the rate.
   */
  exchangeRate: RATE.nullish(),
  totalIls: MONEY_MAJOR.nullish(),
  paidStatus: z.enum(PAID_STATUSES),
});
export type FileExternalDocInput = z.infer<typeof FileExternalDocSchema>;

/** Corrections to a filed past document. The file itself and its source never change. */
export const UpdateExternalDocSchema = FileExternalDocSchema.omit({ uploadId: true, source: true })
  .partial()
  .extend({
    /** The service from the catalog (items). Null clears it. */
    itemId: z.number().int().positive().nullable().optional(),
  });
export type UpdateExternalDocInput = z.infer<typeof UpdateExternalDocSchema>;

export const LinkReceiptSchema = z.object({ documentId: z.number().int().positive() });

export interface ExternalDocumentUploadRow {
  id: number;
  r2_key: string;
  sha256: string;
  filename: string;
  content_type: string;
  extracted_json: string | null;
  extraction_error: string | null;
  filed_document_id: number | null;
  uploaded_by: number | null;
  uploaded_at: string;
}

export interface ExternalDocumentRow {
  id: number;
  source: ExternalSource;
  original_number: string;
  doc_type: string;
  issue_date: string;
  client_id: number | null;
  client_name_text: string;
  client_tax_id: string | null;
  currency: string;
  amount_before_vat_minor: number;
  vat_amount_minor: number;
  total_minor: number;
  total_ils_minor: number | null;
  fx_rate: string | null;
  fx_rate_date: string | null;
  paid_status: PaidStatus;
  item_id: number | null;
  r2_key: string;
  sha256: string;
  upload_id: number | null;
  filed_by: number | null;
  filed_at: string;
}
