import { z } from 'zod';

/** Batches this run writes to `import_batches.kind`. */
export const IMPORT_KINDS = ['wave_customers', 'wave_invoices', 'sumit_unified'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export interface ImportBatchRow {
  id: number;
  kind: ImportKind;
  filename: string;
  status: 'committed';
  mapping_json: string | null;
  summary_json: string | null;
  created_by: number | null;
  created_at: string;
}

export type HistorySourceKind = 'wave_invoice' | 'sumit_c100' | 'sumit_d110' | 'sumit_d120';

export interface HistoryRow {
  id: number;
  import_batch_id: number;
  source: 'wave' | 'sumit';
  source_kind: HistorySourceKind;
  external_id: string | null;
  client_id: number | null;
  client_name: string | null;
  doc_type: string | null;
  doc_number: string | null;
  doc_date: string | null;
  currency: string | null;
  amount_minor: number | null;
  status: string | null;
  raw_line: string | null;
  raw_json: string;
  decoded: number;
  decode_note: string | null;
  created_at: string;
}

/** Target client fields a CSV column can map to. `nameEn` is the only one every row needs. */
export const WAVE_CUSTOMER_FIELDS = [
  'nameEn',
  'nameHe',
  'companyId',
  'vatNumber',
  'country',
  'currency',
  'email',
  'phone',
  'addressEn',
  'notes',
] as const;
export type WaveCustomerField = (typeof WAVE_CUSTOMER_FIELDS)[number];

/** Target history fields a Wave invoice CSV column can map to. `externalId` is the dedupe key. */
export const WAVE_INVOICE_FIELDS = ['externalId', 'clientName', 'docNumber', 'docDate', 'currency', 'amount', 'status'] as const;
export type WaveInvoiceField = (typeof WAVE_INVOICE_FIELDS)[number];

/** A loose record of target field -> CSV column header. Unknown keys are ignored by the
 * service (it only reads the field names in WAVE_CUSTOMER_FIELDS / WAVE_INVOICE_FIELDS), so
 * validation here just shapes the values rather than the exhaustive key set. */
const mappingSchema = z.record(z.string(), z.string().trim().min(1).nullish());
export const waveCustomerMappingSchema = mappingSchema;
export const waveInvoiceMappingSchema = mappingSchema;

export type WaveCustomerMapping = Partial<Record<WaveCustomerField, string | null>>;
export type WaveInvoiceMapping = Partial<Record<WaveInvoiceField, string | null>>;

export interface RowError {
  row: number;
  message: string;
}

export interface CommitSummary {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: RowError[];
}

export const setSeriesStartSchema = z.object({
  startNumber: z.number().int().min(1),
  confirm: z.boolean().refine((v) => v === true, 'Confirm the starting number before it is set.'),
  note: z.string().trim().max(500).nullish(),
});
