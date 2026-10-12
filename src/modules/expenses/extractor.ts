import type { Env } from '../../env';
import { documentReaderFor } from '../ai';
import { type ExtractedExpense, ExtractedExpenseSchema } from './types';

export interface ExtractInput {
  bytes: ArrayBuffer;
  contentType: string;
  filename: string;
}

/** Reads supplier, document and amount fields from one expense file. */
export interface Extractor {
  extract(input: ExtractInput): Promise<ExtractedExpense>;
}

const TOOL_NAME = 'record_expense';

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    supplierName: { type: 'string', description: 'The supplier or vendor name on the document' },
    supplierId: { type: ['string', 'null'], description: 'The supplier company or VAT number, if printed' },
    documentNumber: { type: ['string', 'null'], description: 'The invoice, receipt or document number' },
    date: { type: ['string', 'null'], description: 'The document date as YYYY-MM-DD' },
    currency: { type: 'string', description: 'ISO currency code, for example ILS, USD, EUR, GBP' },
    amount: { type: 'string', description: 'Total amount including VAT, as a plain decimal string, for example "123.45"' },
    vatAmount: { type: ['string', 'null'], description: 'VAT amount, as a plain decimal string, or null if none is shown' },
    documentType: { type: ['string', 'null'], description: 'The document type printed on it, for example "Tax invoice" or "Receipt"' },
  },
  required: ['supplierName', 'currency', 'amount'],
} as const;

/** Reads one expense file with the chosen provider (R24 Phase 0). No key: an error, so the file waits for manual entry. */
export class AiExtractor implements Extractor {
  constructor(
    private readonly env: Env,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async extract(input: ExtractInput): Promise<ExtractedExpense> {
    const reader = documentReaderFor(this.env, this.fetchFn);
    if (!reader) throw new Error('No document reading key is set.');
    const answer = await reader.read({
      bytes: input.bytes,
      contentType: input.contentType,
      name: TOOL_NAME,
      description: 'Records the expense fields read from the document.',
      schema: INPUT_SCHEMA,
      prompt:
        'Read this expense document (invoice, receipt or bill) and call record_expense with its fields. Use null for anything not printed on the document.',
    });
    const parsed = ExtractedExpenseSchema.safeParse(answer);
    if (!parsed.success) throw new Error(`The ${reader.provider} answer does not fit the expense fields.`);
    return parsed.data;
  }
}
