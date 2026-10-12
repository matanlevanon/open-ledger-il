import type { Env } from '../../env';
import { BUSINESS_DOCUMENT_TYPES, type ExtractedBusinessDocument, ExtractedBusinessDocumentSchema } from './types';
import { documentReaderFor } from '../ai';

/** Reads the type, names, tax ID and dates from one certificate. */
export interface BusinessDocumentReader {
  read(input: { bytes: ArrayBuffer; contentType: string }): Promise<ExtractedBusinessDocument>;
}

const SCHEMA = {
  type: 'object',
  properties: {
    type: {
      type: ['string', 'null'],
      enum: [...BUSINESS_DOCUMENT_TYPES, null],
      description:
        'vat_registration (תעודת עוסק פטור or מורשה), company_registration (תעודת התאגדות), bookkeeping (אישור ניהול ספרים), withholding (אישור ניכוי מס במקור), bank_account (אישור ניהול חשבון), other',
    },
    nameHe: { type: ['string', 'null'], description: 'The business or company name in Hebrew, as printed' },
    nameEn: { type: ['string', 'null'], description: 'The business or company name in English, if printed' },
    taxId: { type: ['string', 'null'], description: 'The עוסק number, ת"ז or ח.פ. (company number), digits only' },
    issueDate: { type: ['string', 'null'], description: 'The issue date as YYYY-MM-DD' },
    validUntil: { type: ['string', 'null'], description: 'The date the certificate is valid until, as YYYY-MM-DD' },
  },
  required: [],
} as const;

/**
 * Reads a certificate with the provider from Phase 0 (Anthropic or Gemini). Null when no key is
 * set: the upload still works and the owner types the fields.
 */
export function businessDocumentReaderFor(env: Env, fetchFn: typeof fetch = fetch): BusinessDocumentReader | null {
  const reader = documentReaderFor(env, fetchFn);
  if (!reader) return null;
  return {
    async read({ bytes, contentType }) {
      const answer = await reader.read({
        bytes,
        contentType,
        name: 'record_certificate',
        description: 'Records the fields read from an Israeli business certificate.',
        schema: SCHEMA,
        prompt:
          'Read this Israeli business certificate and call record_certificate with its fields. Use null for anything not printed on the document.',
      });
      const parsed = ExtractedBusinessDocumentSchema.safeParse(answer);
      if (!parsed.success) throw new Error(`The ${reader.provider} answer does not fit the certificate fields.`);
      return parsed.data;
    },
  };
}

/** Test reader: returns the same fields for every file. */
export function fakeBusinessDocumentReader(fields: ExtractedBusinessDocument): BusinessDocumentReader & { calls: number } {
  const fake = {
    calls: 0,
    async read() {
      fake.calls += 1;
      return fields;
    },
  };
  return fake;
}
