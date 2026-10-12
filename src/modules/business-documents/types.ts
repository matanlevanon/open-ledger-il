import { z } from 'zod';

/** R24 Phase C: the certificates a business keeps. */
export const BUSINESS_DOCUMENT_TYPES = ['vat_registration', 'company_registration', 'bookkeeping', 'withholding', 'bank_account', 'other'] as const;
export type BusinessDocumentType = (typeof BUSINESS_DOCUMENT_TYPES)[number];

/** Types that end. The 07:00 cron warns 30 days before valid_until. */
export const EXPIRING_TYPES: readonly BusinessDocumentType[] = ['bookkeeping', 'withholding'];
export const EXPIRY_WARNING_DAYS = 30;

export const TYPE_LABELS: Record<BusinessDocumentType, { en: string; he: string }> = {
  vat_registration: { en: 'VAT registration certificate', he: 'תעודת עוסק פטור / מורשה' },
  company_registration: { en: 'Company registration certificate', he: 'תעודת התאגדות' },
  bookkeeping: { en: 'Bookkeeping certificate', he: 'אישור ניהול ספרים' },
  withholding: { en: 'Withholding tax certificate', he: 'אישור ניכוי מס במקור' },
  bank_account: { en: 'Bank account confirmation', he: 'אישור ניהול חשבון' },
  other: { en: 'Other', he: 'אחר' },
};

export const ALLOWED_CONTENT_TYPES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' } as const;
export type AllowedContentType = keyof typeof ALLOWED_CONTENT_TYPES;
export const MAX_BYTES = 10 * 1024 * 1024;

/** Share link lifetimes the owner picks from. Default 7. */
export const SHARE_DAYS = [1, 7, 30] as const;
export const DEFAULT_SHARE_DAYS = 7;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** What the document reader returns. Every field may be missing. */
export const ExtractedBusinessDocumentSchema = z.object({
  type: z.enum(BUSINESS_DOCUMENT_TYPES).nullish(),
  nameHe: z.string().trim().nullish(),
  nameEn: z.string().trim().nullish(),
  taxId: z.string().trim().nullish(),
  issueDate: isoDate.nullish(),
  validUntil: isoDate.nullish(),
});
export type ExtractedBusinessDocument = z.infer<typeof ExtractedBusinessDocumentSchema>;

export interface BusinessDocumentRow {
  id: number;
  business_id: number;
  type: BusinessDocumentType;
  r2_key: string;
  sha256: string;
  file_name: string;
  content_type: AllowedContentType;
  size_bytes: number;
  issue_date: string | null;
  valid_until: string | null;
  extracted_json: string | null;
  confirmed_at: string | null;
  replaced_by: number | null;
  expiry_alerted_at: string | null;
  uploaded_by: number | null;
  uploaded_at: string;
}

export interface BusinessDocumentLinkRow {
  id: number;
  business_id: number;
  document_id: number;
  expires_at: string;
  channel: 'link' | 'email' | 'whatsapp';
  sent_to: string | null;
  created_by: number | null;
  created_at: string;
  revoked_at: string | null;
  revoked_by: number | null;
  open_count: number;
  last_opened_at: string | null;
}
