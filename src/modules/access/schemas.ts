import { z } from 'zod';
import { assertDate } from '../../core/db';
import { ACCOUNTANT_FEATURES } from '../../core/auth';

const dateString = z.string().refine(
  (v) => {
    try {
      assertDate(v);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Must be a real calendar date, YYYY-MM-DD.' },
);

const email = z
  .string()
  .trim()
  .email()
  .transform((v) => v.toLowerCase());

const name = z.string().trim().min(1).max(200).nullable().optional();

const featureMap = z.partialRecord(z.enum(ACCOUNTANT_FEATURES), z.boolean());

export const inviteAccountantSchema = z.object({
  email,
  name,
  accessEndsOn: dateString,
  features: featureMap.optional(),
});
export type InviteAccountantInput = z.infer<typeof inviteAccountantSchema>;

export const updateAccountantSchema = z
  .object({
    name,
    accessEndsOn: dateString.optional(),
    features: featureMap.optional(),
  })
  .refine((v) => v.name !== undefined || v.accessEndsOn !== undefined || v.features !== undefined, {
    message: 'Nothing to update.',
  });
export type UpdateAccountantInput = z.infer<typeof updateAccountantSchema>;

export const accessLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().min(1).optional(),
  userEmail: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
});
export type AccessLogQuery = z.infer<typeof accessLogQuerySchema>;
