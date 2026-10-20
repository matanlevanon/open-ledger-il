import { z } from 'zod';
import { ApiClientInput, ApiDraftInput, DRAFT_TYPES } from './schemas';

/**
 * R41: OpenAPI 3.1 for /v1. The request bodies come from the zod schemas the router parses with.
 * The answers are written here by hand. A test checks every route of the router is listed.
 */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const money = { type: 'integer', description: 'Minor units: agorot or cents. 11800 is 118.00.' };
const nullable = (type: string) => ({ type: [type, 'null'] });

const pageOf = (item: string) => ({
  type: 'object',
  required: ['data', 'nextCursor'],
  properties: { data: { type: 'array', items: ref(item) }, nextCursor: { ...nullable('string'), description: 'Pass as `cursor` for the next page. Null on the last page.' } },
});

const pagingParams = [
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
  { name: 'cursor', in: 'query', schema: { type: 'string' }, description: '`nextCursor` from the previous page.' },
  { name: 'updatedSince', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Only rows changed after this time, to sync changes only.' },
];
const dateParam = (name: string, description: string) => ({ name, in: 'query', schema: { type: 'string', format: 'date' }, description });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };

const errors = (...codes: number[]) =>
  Object.fromEntries(codes.map((code) => [String(code), { description: ERROR_TEXT[code], content: { 'application/json': { schema: ref('Error') } } }]));

const ERROR_TEXT: Record<number, string> = {
  400: 'Bad request.',
  401: 'Missing, unknown or revoked key.',
  403: 'The key belongs to another business, or a read key on a write call (scope_required).',
  404: 'No such record in this business.',
  409: 'Conflict, for example a PDF of a document that is not final, or an Idempotency-Key reused with another body.',
  422: 'A field is not valid.',
  429: 'More than 120 requests in a minute. Wait for Retry-After seconds.',
};

const read = (summary: string, schema: object, extra: { parameters?: object[]; description?: string } = {}) => ({
  get: {
    summary,
    ...(extra.description ? { description: extra.description } : {}),
    parameters: extra.parameters ?? [],
    responses: { '200': { description: 'OK', content: { 'application/json': { schema } } }, ...errors(401, 403, 404, 422, 429) },
  },
});

export function buildOpenApi(origin: string) {
  const clientBody = z.toJSONSchema(ApiClientInput, { io: 'input' });
  const draftBody = z.toJSONSchema(ApiDraftInput, { io: 'input' });
  return {
    openapi: '3.1.0',
    info: {
      title: 'Open Ledger IL API',
      version: '1.0.0',
      description:
        'Read the Ledger, and with a write key create clients and draft documents. No call finalizes, sends, credits or deletes a document: issuing a tax document stays a person\'s act in the Ledger. ' +
        'Money is in minor units with a currency. Dates are YYYY-MM-DD, times ISO UTC. Lists page with `limit` and `cursor`.',
    },
    servers: [{ url: `${origin}/v1` }],
    security: [{ apiKey: [], businessId: [] }],
    components: {
      securitySchemes: {
        apiKey: { type: 'http', scheme: 'bearer', description: 'Authorization: Bearer ol_live_... Made in Settings > MCP and API.' },
        businessId: { type: 'apiKey', in: 'header', name: 'X-Business-Id', description: 'The Business ID from Settings > MCP and API, or the business tax number.' },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } } },
          example: { error: { code: 'unauthorized', message: 'A valid API key is required.' } },
        },
        Business: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            nameEn: nullable('string'),
            nameHe: nullable('string'),
            taxId: nullable('string'),
            entityType: { type: 'string', enum: ['osek_patur', 'osek_murshe', 'company'] },
            legalMode: { type: 'string', enum: ['patur', 'murshe'], description: 'patur: עוסק פטור. murshe: עוסק מורשה.' },
            currency: { type: 'string', example: 'ILS' },
            addressEn: nullable('string'),
            addressHe: nullable('string'),
            email: nullable('string'),
            phone: nullable('string'),
          },
        },
        Client: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            nameEn: nullable('string'),
            nameHe: nullable('string'),
            companyId: nullable('string'),
            email: nullable('string'),
            currency: { type: 'string' },
            active: { type: 'boolean' },
            openBalance: { type: 'object', additionalProperties: money, description: 'Open amount per currency.', example: { ILS: 11800 } },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Document: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            type: { type: 'string', description: 'Type code: QT quote, PR payment request, PF pro forma, 300 transaction invoice, 305 tax invoice, 320 tax invoice receipt, 330 credit, 400 receipt, 405 credit receipt.' },
            typeName: { type: 'string' },
            number: { ...nullable('string'), example: 'PR-0004' },
            status: { type: 'string', enum: ['draft', 'final', 'cancelled', 'awaiting_allocation', 'allocation_pending', 'allocation_refused'] },
            state: { type: 'string', description: 'open, partial, paid, converted, final, credited and so on.' },
            date: { type: 'string', format: 'date' },
            dueDate: { ...nullable('string'), format: 'date' },
            clientId: nullable('integer'),
            clientName: nullable('string'),
            currency: { type: 'string' },
            totals: {
              type: 'object',
              properties: { subtotal: money, vat: money, total: money, paid: { ...money, type: ['integer', 'null'] }, open: { ...money, type: ['integer', 'null'] } },
            },
            allocationNumber: nullable('string'),
            relatedDocumentIds: { type: 'array', items: { type: 'integer' } },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        DocumentDetail: {
          allOf: [
            ref('Document'),
            {
              type: 'object',
              properties: {
                exchangeRate: nullable('string'),
                vatRateBp: { ...nullable('integer'), description: 'VAT in basis points: 1800 is 18%.' },
                lines: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { description: { type: 'string' }, quantity: { type: 'number' }, quantityMilli: { type: 'integer' }, unitPrice: money, discount: money, vatRateBp: nullable('integer'), lineTotal: money },
                  },
                },
                payments: {
                  type: 'array',
                  items: { type: 'object', properties: { date: { type: 'string', format: 'date' }, method: { type: 'string' }, amount: money, currency: { type: 'string' }, reference: nullable('string') } },
                },
              },
            },
          ],
        },
        Draft: { allOf: [ref('DocumentDetail'), { type: 'object', properties: { editUrl: { type: 'string', description: 'The Ledger page where a person checks and issues the draft.' } } }] },
        Payment: {
          type: 'object',
          properties: { id: { type: 'integer' }, documentId: { type: 'integer' }, date: { type: 'string', format: 'date' }, method: { type: 'string' }, amount: money, currency: { type: 'string' }, reference: nullable('string'), createdAt: { type: 'string', format: 'date-time' } },
        },
        Expense: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            status: { type: 'string', enum: ['new', 'filed', 'not_expense', 'duplicate', 'returned'] },
            supplierName: nullable('string'),
            supplierTaxId: nullable('string'),
            documentType: nullable('string'),
            documentNumber: nullable('string'),
            date: { ...nullable('string'), format: 'date' },
            currency: { type: 'string' },
            total: money,
            vat: money,
            totalIls: { ...money, type: ['integer', 'null'] },
            category: nullable('string'),
            readStatus: { type: ['string', 'null'], enum: ['read', 'failed', 'manual', null] },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Supplier: {
          type: 'object',
          properties: { id: { type: 'integer' }, name: { type: 'string' }, taxId: nullable('string'), country: { type: 'string' }, currency: { type: 'string' }, updatedAt: { type: 'string', format: 'date-time' } },
        },
        ClientInput: clientBody,
        DraftInput: draftBody,
      },
    },
    paths: {
      '/openapi.json': { get: { summary: 'This document. No key needed.', security: [], responses: { '200': { description: 'OpenAPI 3.1' } } } },
      '/business': read('The business', ref('Business')),
      '/clients': {
        ...read('Clients', pageOf('Client'), {
          parameters: [...pagingParams, { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Name, company id or email contains.' }, { name: 'active', in: 'query', schema: { type: 'boolean' } }],
        }),
        post: {
          summary: 'Create a client (write key)',
          parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: ref('ClientInput'), example: { nameEn: 'Acme Ltd', email: 'billing@acme.example', companyId: '515555555' } } } },
          responses: { '201': { description: 'Created', content: { 'application/json': { schema: ref('Client') } } }, ...errors(401, 403, 409, 422, 429) },
        },
      },
      '/clients/{id}': read('One client', ref('Client'), { parameters: [idParam] }),
      '/documents': {
        ...read('Documents', pageOf('Document'), {
          parameters: [
            ...pagingParams,
            { name: 'type', in: 'query', schema: { type: 'string' }, description: 'Type codes, comma separated: 305,320' },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            dateParam('from', 'Document date from'),
            dateParam('to', 'Document date to'),
            { name: 'clientId', in: 'query', schema: { type: 'integer' } },
          ],
        }),
        post: {
          summary: 'Create a draft document (write key)',
          description: `Types: ${DRAFT_TYPES.join(', ')}. A draft has no number. A person issues it in the Ledger at editUrl.`,
          parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' }, description: 'The same key and body within 24 hours returns the first answer.' }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('DraftInput'), example: { type: 'PR', clientId: 12, lines: [{ description: 'Consulting, October', unitPriceMinor: 500000 }] } } },
          },
          responses: { '201': { description: 'Created', content: { 'application/json': { schema: ref('Draft') } } }, ...errors(401, 403, 404, 409, 422, 429) },
        },
      },
      '/documents/{id}': read('One document with lines and payments', ref('DocumentDetail'), { parameters: [idParam] }),
      '/documents/{id}/pdf': {
        get: {
          summary: 'The client copy PDF of a final document',
          parameters: [idParam],
          responses: { '200': { description: 'PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } }, ...errors(401, 403, 404, 409, 429) },
        },
      },
      '/payments': read('Payments recorded on final documents', pageOf('Payment'), { parameters: [...pagingParams, dateParam('from', 'Paid on from'), dateParam('to', 'Paid on to')] }),
      '/expenses': read('Expenses', pageOf('Expense'), {
        parameters: [...pagingParams, dateParam('from', 'Document date from'), dateParam('to', 'Document date to'), { name: 'status', in: 'query', schema: { type: 'string' } }],
      }),
      '/suppliers': read('Suppliers', pageOf('Supplier'), { parameters: pagingParams }),
    },
  };
}
