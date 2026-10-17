import type { Env } from '../../env';
import { documentReaderFor } from '../ai';
import { EMPTY_EXTRACTION, type ExtractedExternalDoc, ExtractedExternalDocSchema } from './upload-types';

export interface ExternalDocExtractInput {
  bytes: ArrayBuffer;
  contentType: string;
  filename: string;
}

/** Reads source, type, number, date, client and amount fields from one uploaded document. */
export interface ExternalDocExtractor {
  extract(input: ExternalDocExtractInput): Promise<ExtractedExternalDoc>;
}

const TOOL_NAME = 'record_external_document';

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    source: { type: ['string', 'null'], enum: ['sumit', 'wave', 'other', null], description: 'The system that issued this document, if identifiable from its layout or footer' },
    documentType: { type: ['string', 'null'], description: 'The document type printed on it, for example "Tax invoice" or "Receipt"' },
    originalNumber: { type: ['string', 'null'], description: 'The document number as printed in the source system' },
    issueDate: {
      type: ['string', 'null'],
      description:
        'The document date as YYYY-MM-DD. Israeli documents print dates day first (DD/MM/YYYY): 05/08/2026 is 5 August 2026, so return 2026-08-05.',
    },
    clientName: { type: ['string', 'null'], description: "The client's name as printed on the document" },
    clientTaxId: { type: ['string', 'null'], description: "The client's company or VAT number, if printed" },
    currency: { type: ['string', 'null'], description: 'ISO currency code, for example ILS, USD, EUR, GBP' },
    amountBeforeVat: { type: ['string', 'null'], description: 'The amount before VAT, as a plain decimal string' },
    vatAmount: { type: ['string', 'null'], description: 'The VAT amount, as a plain decimal string, or null if none is shown' },
    total: { type: ['string', 'null'], description: 'The total amount including VAT, as a plain decimal string' },
    exchangeRate: {
      type: ['string', 'null'],
      description:
        'For a document not in ILS: the exchange rate to the shekel printed on the document (for example "Document exchange rate $1 = 2.988" gives "2.988"), as a plain decimal string. Null when no rate is printed. Never look up or guess a rate.',
    },
    totalIls: {
      type: ['string', 'null'],
      description: 'For a document not in ILS: the total in shekels printed on the document, as a plain decimal string. Null when none is printed.',
    },
    paidStatus: { type: ['string', 'null'], enum: ['paid', 'unpaid', 'unknown', null], description: 'Whether the document itself shows it as paid' },
  },
  required: ['source', 'documentType', 'originalNumber', 'issueDate', 'clientName', 'clientTaxId', 'currency', 'amountBeforeVat', 'vatAmount', 'total', 'exchangeRate', 'totalIls', 'paidStatus'],
} as const;

/** Reads one uploaded document with the chosen provider (R24 Phase 0). No key: empty fields for manual entry. */
export class AiExternalDocExtractor implements ExternalDocExtractor {
  constructor(
    private readonly env: Env,
    private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async extract(input: ExternalDocExtractInput): Promise<ExtractedExternalDoc> {
    const reader = documentReaderFor(this.env, this.fetchFn);
    if (!reader) return EMPTY_EXTRACTION;
    const answer = await reader.read({
      bytes: input.bytes,
      contentType: input.contentType,
      name: TOOL_NAME,
      description: 'Records the fields read from a previously-issued document.',
      schema: INPUT_SCHEMA,
      prompt:
        'Read this previously-issued invoice or receipt (from SUMIT, Wave or another system) and call record_external_document with its fields. Use null for anything not printed on the document.',
    });
    const parsed = ExtractedExternalDocSchema.safeParse(answer);
    if (!parsed.success) throw new Error(`The ${reader.provider} answer does not fit the document fields.`);
    return parsed.data;
  }
}
