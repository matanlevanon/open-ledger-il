import { z } from 'zod';
import { partialWithoutDefaults } from '../../core/schema';
import { currency, dateString } from '../documents/schemas';

const text = (max: number) => z.string().trim().max(max).nullish();

/** R19: a client needs at least one of nameEn, nameHe. Both may be filled. */
const clientFields = z.object({
  nameEn: text(200),
  nameHe: text(200),
  companyId: text(40),
  vatNumber: text(40),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'Use a two-letter country code.')
    .transform((v) => v.toUpperCase())
    .default('IL'),
  foreignResident: z.boolean().default(false),
  currency: currency.default('ILS'),
  clientCopyLang: z.enum(['en', 'bilingual']).default('en'),
  email: z.string().trim().email('Use a valid email.').max(200).nullish().or(z.literal('').transform(() => null)),
  phone: text(40),
  addressEn: text(500),
  addressHe: text(500),
  cityEn: text(100),
  cityHe: text(100),
  postalCode: text(20),
  notes: text(5000),
  /** Prefills a new quote or payment request for this client (R16 task 7); falls back to the business default. */
  paymentInstructions: text(5000),
});

/** R19 rule 1: a client must have at least one of nameEn, nameHe. Both fields are already trimmed. */
export function hasClientName(names: { nameEn?: string | null; nameHe?: string | null }): boolean {
  return Boolean(names.nameEn) || Boolean(names.nameHe);
}

export const NO_NAME_MESSAGE = 'Add an English or a Hebrew name.';

/**
 * R19 part 2: a client with only a Hebrew name gets bilingual documents by default (the bilingual
 * copy uses the Hebrew layout); every other client defaults to English. An explicit value wins.
 */
export function defaultCopyLang(names: { nameEn?: string | null; nameHe?: string | null }): 'en' | 'bilingual' {
  return !names.nameEn && names.nameHe ? 'bilingual' : 'en';
}

export const clientInput = clientFields
  .extend({ clientCopyLang: z.enum(['en', 'bilingual']).optional() })
  .refine(hasClientName, { message: NO_NAME_MESSAGE, path: ['nameEn'] })
  .transform((v) => ({ ...v, clientCopyLang: v.clientCopyLang ?? defaultCopyLang(v) }));

export const clientPatch = partialWithoutDefaults(clientFields);

/** Manual consent from the client create/edit form. Omit to leave consent unchanged. */
export const consentInput = z.object({
  granted: z.boolean(),
  source: z.enum(['signed_contract', 'other']),
  date: dateString,
  note: text(500),
});

export const consentPatch = z.object({ consent: consentInput.nullish() });

export const contactInput = z.object({
  name: z.string().trim().min(1, 'Add a name.').max(200),
  role: text(100),
  email: z.string().trim().email('Use a valid email.').max(200).nullish().or(z.literal('').transform(() => null)),
  phone: text(40),
  isPrimary: z.boolean().default(false),
});

export const contactPatch = partialWithoutDefaults(contactInput);

export const clientListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  /** '1' (default): active only. '0': not active only. 'all': every client (R18 task 6). */
  active: z.enum(['0', '1', 'all']).default('1'),
});

export const ledgerQuery = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
});

export type ClientInput = z.infer<typeof clientInput>;
export type ClientPatch = z.infer<typeof clientPatch>;
export type ContactInput = z.infer<typeof contactInput>;
export type ConsentInput = z.infer<typeof consentInput>;
