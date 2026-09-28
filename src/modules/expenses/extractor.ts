import type { Env } from '../../env';
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
const EXTRACTION_MODEL = 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';

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

/** Claude with vision, forced to answer through one tool call so the output matches the schema. */
export class AnthropicExtractor implements Extractor {
  constructor(private readonly env: Env) {}

  async extract(input: ExtractInput): Promise<ExtractedExpense> {
    const apiKey = this.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');

    const base64 = arrayBufferToBase64(input.bytes);
    const isPdf = input.contentType === 'application/pdf';
    const documentBlock = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: input.contentType, data: base64 } };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: EXTRACTION_MODEL,
        max_tokens: 1024,
        tools: [{ name: TOOL_NAME, description: 'Records the expense fields read from the document.', input_schema: INPUT_SCHEMA }],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [
          {
            role: 'user',
            content: [
              documentBlock,
              {
                type: 'text',
                text: 'Read this expense document (invoice, receipt or bill) and call record_expense with its fields. Use null for anything not printed on the document.',
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic extraction failed: ${res.status} ${await res.text()}`);

    const body = (await res.json()) as { content: { type: string; name?: string; input?: unknown }[] };
    const toolUse = body.content.find((block) => block.type === 'tool_use' && block.name === TOOL_NAME);
    if (!toolUse) throw new Error('Anthropic did not return the record_expense tool call.');
    return ExtractedExpenseSchema.parse(toolUse.input);
  }
}

function arrayBufferToBase64(bytes: ArrayBuffer): string {
  let binary = '';
  const view = new Uint8Array(bytes);
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}
