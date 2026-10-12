import { z } from 'zod';

export const switchInput = z.object({
  /** Required for `becoming`. `registered` always starts today. */
  effectiveDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional(),
  reason: z.string().trim().min(1).nullable().optional(),
  /** Re-saves every open draft so its stored total picks up VAT immediately. Never touches a final document. */
  repriceDrafts: z.boolean().default(false),
  /** R24: `becoming` (default) or `registered`, the business was מורשה before the Ledger. */
  kind: z.enum(['becoming', 'registered']).default('becoming'),
});
export type SwitchInput = z.infer<typeof switchInput>;

/** R24: start-company takes only an optional note. */
export const startCompanyInput = z.object({
  reason: z.string().trim().min(1).nullable().optional(),
});

/** R24: the VAT reporting frequency, a business setting. */
export const vatReportingInput = z.object({
  vatReporting: z.enum(['monthly', 'bimonthly']),
});
