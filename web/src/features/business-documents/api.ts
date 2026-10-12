import { ApiError, type ApiErrorBody, apiGet } from '../../api/client';
import { apiSend } from '../documents/api';

/** R24 Phase C: /api/business-documents. */
export type BusinessDocumentType = 'vat_registration' | 'company_registration' | 'bookkeeping' | 'withholding' | 'bank_account' | 'other';

export interface Extracted {
  type?: BusinessDocumentType | null;
  nameHe?: string | null;
  nameEn?: string | null;
  taxId?: string | null;
  issueDate?: string | null;
  validUntil?: string | null;
}

export interface ExtractionCheck {
  taxIdValid: boolean | null;
  taxIdMatches: boolean | null;
}

export interface BusinessDocument {
  id: number;
  type: BusinessDocumentType;
  typeLabel: { en: string; he: string };
  fileName: string;
  contentType: string;
  sizeBytes: number;
  issueDate: string | null;
  validUntil: string | null;
  extracted: Extracted | null;
  check: ExtractionCheck;
  confirmedAt: string | null;
  current: boolean;
  replacedBy: number | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

export interface DocumentsList {
  documents: BusinessDocument[];
  types: { type: BusinessDocumentType; label: { en: string; he: string }; expires: boolean }[];
  shareDays: number[];
  reader: { provider: string | null; keySet: boolean };
  canManage: boolean;
  canShare: boolean;
}

export interface ShareLink {
  id: number;
  documentId: number;
  documentType: BusinessDocumentType;
  fileName: string;
  channel: 'link' | 'email' | 'whatsapp';
  sentTo: string | null;
  expiresAt: string;
  createdAt: string;
  createdBy: string | null;
  openCount: number;
  lastOpenedAt: string | null;
}

async function postForm<T>(path: string, form: FormData, businessId?: number): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (businessId !== undefined) headers['X-Business-Id'] = String(businessId);
  const res = await fetch(`/api${path}`, { method: 'POST', body: form, headers });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, err?.error.code ?? 'http_error', err?.error.message ?? 'Upload failed.', err?.error.details);
  }
  return (await res.json()) as T;
}

export const fetchDocuments = () => apiGet<DocumentsList>('/business-documents');

export interface UploadInput {
  file: File;
  type: BusinessDocumentType;
  issueDate?: string;
  validUntil?: string;
}

/** Uploads to the open business, or to `businessId` (Add business uploads to the new one). */
export function uploadDocument(input: UploadInput, businessId?: number): Promise<{ document: BusinessDocument; readError: string | null }> {
  const form = new FormData();
  form.set('file', input.file);
  form.set('type', input.type);
  if (input.issueDate) form.set('issueDate', input.issueDate);
  if (input.validUntil) form.set('validUntil', input.validUntil);
  return postForm('/business-documents', form, businessId);
}

/** Reads a certificate without storing it. Add business fills its form from this. */
export function readCertificate(file: File): Promise<{ extracted: Extracted | null; check: ExtractionCheck; readError: string | null; reader: boolean }> {
  const form = new FormData();
  form.set('file', file);
  return postForm('/business-documents/read', form);
}

export const confirmDocument = (id: number, input: { issueDate: string | null; validUntil: string | null }) =>
  apiSend<{ document: BusinessDocument }>('POST', `/business-documents/${id}/confirm`, input);

export const shareDocument = (id: number, days: number, channel: 'link' | 'whatsapp') =>
  apiSend<{ link: { id: number; url: string; expiresAt: string } }>('POST', `/business-documents/${id}/share`, { days, channel });

export const emailDocument = (id: number, days: number, to: string) =>
  apiSend<{ link: { id: number; url: string; expiresAt: string } }>('POST', `/business-documents/${id}/share/email`, { days, to });

export const fetchLinks = () => apiGet<{ links: ShareLink[] }>('/business-documents/links');
export const revokeLink = (id: number) => apiSend<{ links: ShareLink[] }>('POST', `/business-documents/links/${id}/revoke`);

export const fileUrl = (id: number, download = false) => `/api/business-documents/${id}/file${download ? '?download=1' : ''}`;

/** "Use these details": Settings > Business picks these up and fills its form. The owner saves. */
export const PREFILL_KEY = 'ledger.businessPrefill';
export interface BusinessPrefill {
  nameEn?: string;
  nameHe?: string;
  taxId?: string;
}

export function storePrefill(p: BusinessPrefill): void {
  try {
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify(p));
  } catch {
    // Private mode: the button does nothing visible beyond switching tabs.
  }
}

export function takePrefill(): BusinessPrefill | null {
  try {
    const raw = sessionStorage.getItem(PREFILL_KEY);
    sessionStorage.removeItem(PREFILL_KEY);
    return raw ? (JSON.parse(raw) as BusinessPrefill) : null;
  } catch {
    return null;
  }
}
