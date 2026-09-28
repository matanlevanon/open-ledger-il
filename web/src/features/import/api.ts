import { ApiError, apiGet } from '../../api/client';

export interface SeriesInfo {
  id: string;
  doc_type: string;
  name_en: string;
  name_he: string | null;
  start_number: number;
  next_number: number;
  started_at: string | null;
  closed_at: string | null;
}

export interface CsvPreview {
  headers: string[];
  totalRows: number;
  sampleRows: Record<string, string>[];
  suggestedMapping: Record<string, string | null>;
}

export interface UnifiedFilePreview {
  totalLines: number;
  recordTypeCounts: Record<string, number>;
  sampleLines: Record<string, string[]>;
  note: string;
}

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

export interface HistoryRow {
  id: number;
  source: 'wave' | 'sumit';
  source_kind: string;
  external_id: string | null;
  client_name: string | null;
  doc_type: string | null;
  doc_number: string | null;
  doc_date: string | null;
  currency: string | null;
  amount_minor: number | null;
  status: string | null;
  decoded: number;
  decode_note: string | null;
  created_at: string;
}

async function upload<T>(path: string, file: File, mapping?: Record<string, string | null>): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  if (mapping) form.append('mapping', JSON.stringify(mapping));
  const res = await fetch(`/api/import${path}`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error: { code: string; message: string } } | null;
    throw new ApiError(res.status, body?.error.code ?? 'http_error', body?.error.message ?? 'Request failed.');
  }
  return (await res.json()) as T;
}

export const previewWaveCustomers = (file: File) => upload<CsvPreview>('/wave/customers/preview', file);
export const commitWaveCustomers = (file: File, mapping: Record<string, string | null>) =>
  upload<{ summary: CommitSummary }>('/wave/customers/commit', file, mapping).then((r) => r.summary);

export const previewWaveInvoices = (file: File) => upload<CsvPreview>('/wave/invoices/preview', file);
export const commitWaveInvoices = (file: File, mapping: Record<string, string | null>) =>
  upload<{ summary: CommitSummary }>('/wave/invoices/commit', file, mapping).then((r) => r.summary);

export const previewSumitUnified = (file: File) => upload<UnifiedFilePreview>('/sumit/unified/preview', file);
export const commitSumitUnified = (file: File) => upload<{ summary: CommitSummary }>('/sumit/unified/commit', file).then((r) => r.summary);

export async function listSeries(): Promise<SeriesInfo[]> {
  return (await apiGet<{ series: SeriesInfo[] }>('/import/series')).series;
}

export async function confirmSeriesStart(seriesId: string, startNumber: number, note?: string): Promise<SeriesInfo> {
  const res = await fetch(`/api/import/series/${seriesId}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startNumber, confirm: true, note: note || undefined }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error: { code: string; message: string } } | null;
    throw new ApiError(res.status, body?.error.code ?? 'http_error', body?.error.message ?? 'Request failed.');
  }
  return ((await res.json()) as { series: SeriesInfo }).series;
}

export async function listHistory(source?: 'wave' | 'sumit'): Promise<HistoryRow[]> {
  const query = source ? `?source=${source}` : '';
  return (await apiGet<{ history: HistoryRow[] }>(`/import/history${query}`)).history;
}

/** R17 task 7: "Upload existing documents". */
export interface ExtractedExternalDoc {
  source: 'sumit' | 'wave' | 'other' | null;
  documentType: string | null;
  originalNumber: string | null;
  issueDate: string | null;
  clientName: string | null;
  clientTaxId: string | null;
  currency: string | null;
  amountBeforeVat: string | null;
  vatAmount: string | null;
  total: string | null;
  paidStatus: 'paid' | 'unpaid' | 'unknown' | null;
}

export interface UploadResult {
  uploadId: number;
  extraction: ExtractedExternalDoc;
  extractionError: string | null;
}

export interface ExternalDocument {
  id: number;
  source: string;
  original_number: string;
  doc_type: string;
  issue_date: string;
  client_id: number | null;
  client_name_text: string;
  currency: string;
  total_minor: number;
  total_ils_minor: number | null;
  paid_status: string;
}

export async function uploadExternalDocument(file: File): Promise<UploadResult> {
  return upload<UploadResult>('/uploads', file);
}

export interface FileExternalDocInput {
  uploadId: number;
  source: 'sumit' | 'wave' | 'other';
  documentType: string;
  originalNumber: string;
  issueDate: string;
  clientId: number | null;
  clientName: string;
  clientTaxId: string | null;
  currency: string;
  amountBeforeVat: string;
  vatAmount: string;
  total: string;
  paidStatus: 'paid' | 'unpaid' | 'unknown';
}

export async function fileExternalDocument(input: FileExternalDocInput): Promise<ExternalDocument> {
  const res = await fetch('/api/import/uploads/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error: { code: string; message: string } } | null;
    throw new ApiError(res.status, body?.error.code ?? 'http_error', body?.error.message ?? 'Request failed.');
  }
  return ((await res.json()) as { document: ExternalDocument }).document;
}
