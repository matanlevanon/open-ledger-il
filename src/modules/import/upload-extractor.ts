import type { Env } from '../../env';
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
const EXTRACTION_MODEL = 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    source: { type: ['string', 'null'], enum: ['sumit', 'wave', 'other', null], description: 'The system that issued this document, if identifiable from its layout or footer' },
    documentType: { type: ['string', 'null'], description: 'The document type printed on it, for example "Tax invoice" or "Receipt"' },
    originalNumber: { type: ['string', 'null'], description: 'The document number as printed in the source system' },
    issueDate: { type: ['string', 'null'], description: 'The document date as YYYY-MM-DD' },
    clientName: { type: ['string', 'null'], description: "The client's name as printed on the document" },
    clientTaxId: { type: ['string', 'null'], description: "The client's company or VAT number, if printed" },
    currency: { type: ['string', 'null'], description: 'ISO currency code, for example ILS, USD, EUR, GBP' },
    amountBeforeVat: { type: ['string', 'null'], description: 'The amount before VAT, as a plain decimal string' },
    vatAmount: { type: ['string', 'null'], description: 'The VAT amount, as a plain decimal string, or null if none is shown' },
    total: { type: ['string', 'null'], description: 'The total amount including VAT, as a plain decimal string' },
    paidStatus: { type: ['string', 'null'], enum: ['paid', 'unpaid', 'unknown', null], description: 'Whether the document itself shows it as paid' },
  },
  required: ['source', 'documentType', 'originalNumber', 'issueDate', 'clientName', 'clientTaxId', 'currency', 'amountBeforeVat', 'vatAmount', 'total', 'paidStatus'],
} as const;

/** Claude with vision, forced to answer through one tool call so the output matches the schema. */
export class AnthropicExternalDocExtractor implements ExternalDocExtractor {
  constructor(private readonly env: Env) {}

  async extract(input: ExternalDocExtractInput): Promise<ExtractedExternalDoc> {
    const apiKey = this.env.ANTHROPIC_API_KEY;
    if (!apiKey) return EMPTY_EXTRACTION;

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
        tools: [{ name: TOOL_NAME, description: 'Records the fields read from a previously-issued document.', input_schema: INPUT_SCHEMA }],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [
          {
            role: 'user',
            content: [
              documentBlock,
              {
                type: 'text',
                text: 'Read this previously-issued invoice or receipt (from SUMIT, Wave or another system) and call record_external_document with its fields. Use null for anything not printed on the document.',
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic extraction failed: ${res.status} ${await res.text()}`);

    const body = (await res.json()) as { content: { type: string; name?: string; input?: unknown }[] };
    const toolUse = body.content.find((block) => block.type === 'tool_use' && block.name === TOOL_NAME);
    if (!toolUse) throw new Error('Anthropic did not return the record_external_document tool call.');
    return ExtractedExternalDocSchema.parse(toolUse.input);
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
