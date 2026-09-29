import { ApiError, apiGet } from '../../api/client';

export interface BusinessProfile {
  id: number;
  name_en: string;
  name_he: string;
  tagline_en: string | null;
  tagline_he: string | null;
  address_en: string | null;
  address_he: string | null;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  bank_details: string | null;
  logo_r2_key: string | null;
  signature_r2_key: string | null;
  payment_link_stripe: string | null;
  payment_link_paypal: string | null;
  payment_instructions: string | null;
  payment_method_ids: string | null;
}

export interface SeriesRow {
  id: string;
  doc_type: string;
  name_en: string;
  name_he: string | null;
  legal_mode: string | null;
  start_number: number;
  next_number: number;
  started_at: string | null;
  closed_at: string | null;
}

export interface CeilingRow {
  id: number;
  year: number;
  amount_minor: number;
  currency: string;
  note: string | null;
}

export interface VatRateRow {
  id: number;
  rate_bp: number;
  effective_from: string;
  note: string | null;
}

export interface BackupRow {
  id: number;
  kind: 'quarterly' | 'manual';
  ran_at: string;
  d1_export_key: string;
  manifest_key: string;
  table_count: number;
  document_count: number;
  chain_head_hash: string;
  restore_ok: number;
  restore_error: string | null;
}

export interface GapCheckResult {
  ok: boolean;
  series: { seriesId: string; docType: string; ok: boolean; count: number; problems: number[] }[];
  chain: { ok: boolean; checked: number; headHash: string; breaks: unknown[] };
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/ops${path}`, {
    method,
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => null)) as { error: { code: string; message: string } } | null;
    throw new ApiError(res.status, errorBody?.error.code ?? 'http_error', errorBody?.error.message ?? 'Request failed.');
  }
  return (await res.json()) as T;
}

export const fetchBusiness = () => apiGet<{ business: BusinessProfile }>('/ops/business');
export const fetchBusinessSetup = () => apiGet<{ complete: boolean; missing: string[] }>('/ops/business/setup');
export const updateBusiness = (patch: Record<string, unknown>) => send<{ business: BusinessProfile }>('/business', 'PUT', patch);

export const fetchSeries = () => apiGet<{ series: SeriesRow[] }>('/ops/series');
export const setSeriesStartNumber = (id: string, startNumber: number) =>
  send<{ series: SeriesRow[] }>(`/series/${id}/start-number`, 'PUT', { startNumber });

export const fetchCeilings = () => apiGet<{ ceilings: CeilingRow[] }>('/ops/ceilings');
export const upsertCeiling = (input: { year: number; amountMinor: number; currency: string; note?: string | null }) =>
  send<{ ceilings: CeilingRow[] }>('/ceilings', 'PUT', input);

export const fetchVatRates = () => apiGet<{ vatRates: VatRateRow[] }>('/ops/vat-rates');
export const addVatRate = (input: { rateBp: number; effectiveFrom: string; note?: string | null }) =>
  send<{ vatRates: VatRateRow[] }>('/vat-rates', 'POST', input);

export const fetchIssuing = () => apiGet<{ enabled: boolean }>('/ops/issuing');
export const setIssuing = (enabled: boolean) => send<{ enabled: boolean }>('/issuing', 'PUT', { enabled });

export const fetchSignatureMode = () => apiGet<{ mode: 'secured' | 'none' }>('/ops/signature-mode');
export const setSignatureMode = (mode: 'secured' | 'none') => send<{ mode: string }>('/signature-mode', 'PUT', { mode });

export interface FxRateRow {
  currency: string;
  rate_date: string;
  rate: string;
  source: string;
  fetched_at: string;
}

async function fxSend<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/fx${path}`, {
    method,
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => null)) as { error: { code: string; message: string } } | null;
    throw new ApiError(res.status, errorBody?.error.code ?? 'http_error', errorBody?.error.message ?? 'Request failed.');
  }
  return (await res.json()) as T;
}

export const fetchRecentRates = (currency: string) => apiGet<{ rates: FxRateRow[] }>(`/fx/rates?currency=${currency}`);
export const backfillRatesNow = (currency: string, from: string) =>
  fxSend<{ currency: string; from: string; to: string; cached: number }>('/rates/backfill', 'POST', { currency, from });

export const fetchBackups = () => apiGet<{ backups: BackupRow[] }>('/ops/backups');
export const runBackupNow = () =>
  send<{ dataKey: string; manifestKey: string; documentCount: number; restoreOk: boolean; restoreError: string | null }>(
    '/backups/run',
    'POST',
  );

export const runChecksNow = () => send<GapCheckResult>('/checks/run', 'POST');

export { ApiError };
