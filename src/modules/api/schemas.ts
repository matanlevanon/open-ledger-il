import { z } from 'zod';

/** R41: the request bodies of /v1, shared by the router and the OpenAPI spec. */

/** The document types a write key may draft: quote, payment request, transaction invoice, receipt. */
export const DRAFT_TYPES = ['QT', 'PR', '300', '400'] as const;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

/** POST /v1/clients: the fields MCP create_client takes. */
export const ApiClientInput = z.object({
  nameEn: z.string().trim().max(200).nullish(),
  nameHe: z.string().trim().max(200).nullish(),
  email: z.string().trim().email('Use a valid email.').max(200).nullish(),
  companyId: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(5000).nullish(),
});

/** POST /v1/documents: a draft of one of DRAFT_TYPES, with the fields MCP create_draft takes. */
export const ApiDraftInput = z.object({
  type: z.enum(DRAFT_TYPES),
  clientId: z.number().int().positive().nullish(),
  date: day.optional(),
  dueDate: day.nullish(),
  currency: z.enum(['ILS', 'USD', 'EUR', 'GBP']).optional(),
  notes: z.string().max(5000).nullish(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(500),
        quantityMilli: z.number().int().positive().max(1_000_000_000).optional(),
        unitPriceMinor: z.number().int(),
        discountMinor: z.number().int().min(0).optional(),
      }),
    )
    .max(200)
    .default([]),
});

