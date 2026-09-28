import { z } from 'zod';

export const switchInput = z.object({
  effectiveDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  reason: z.string().trim().min(1).nullable().optional(),
  /** Re-saves every open draft so its stored total picks up VAT immediately. Never touches a final document. */
  repriceDrafts: z.boolean().default(false),
});
export type SwitchInput = z.infer<typeof switchInput>;
