import { z } from 'zod';
import { currency } from '../documents/schemas';

export const PAYMENT_METHOD_TYPES = ['bank_transfer', 'bit', 'paybox', 'paypal', 'card', 'cash', 'cheque', 'other'] as const;
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

const text = (max: number) => z.string().trim().max(max).nullish();

export const BANK_COUNTRIES = ['IL', 'US', 'OTHER'] as const;
export const US_ACCOUNT_TYPES = ['checking', 'savings'] as const;

/**
 * A US ABA routing number: 9 digits whose weighted sum 3-7-1 is a multiple of 10. Catches a typo
 * before the number is printed on a document a client pays from.
 */
export function isValidAbaRouting(value: string): boolean {
  if (!/^\d{9}$/.test(value)) return false;
  const d = value.split('').map(Number);
  const sum = 3 * (d[0]! + d[3]! + d[6]!) + 7 * (d[1]! + d[4]! + d[7]!) + (d[2]! + d[5]! + d[8]!);
  return sum % 10 === 0;
}

/**
 * Bank transfer's own fields (task 2). `bankCountry` picks the account's format: Israel (bank,
 * branch, account), US for ACH (routing number, account, account type), or another country
 * (IBAN/SWIFT). Absent means Israel, the format every method saved before it existed. Bank
 * address only matters for a foreign transfer, but it is never required.
 */
export const bankDetails = z
  .object({
    bankCountry: z.enum(BANK_COUNTRIES).nullish(),
    bankName: text(200),
    bankNumber: text(20),
    branch: text(20),
    accountNumber: text(40),
    accountHolder: text(200),
    routingNumber: z
      .string()
      .trim()
      .refine(isValidAbaRouting, 'Enter a valid 9-digit US routing number (ABA).')
      .nullish(),
    accountType: z.enum(US_ACCOUNT_TYPES).nullish(),
    iban: text(50),
    swiftBic: text(20),
    bankAddress: text(500),
  })
  .superRefine((d, ctx) => {
    if (d.bankCountry !== 'US') return;
    if (!d.routingNumber) ctx.addIssue({ code: 'custom', path: ['routingNumber'], message: 'A US bank account needs its routing number (ABA).' });
    if (!d.accountNumber) ctx.addIssue({ code: 'custom', path: ['accountNumber'], message: 'A US bank account needs its account number.' });
  });

/** Every other type: one free-text identifier (a phone number, an email, a card note, ...). */
export const genericDetails = z.object({
  identifier: text(200),
});

// A loose bag on the way in: which shape applies depends on `type`, decided below rather than by
// zod union (a union tried bankDetails first and silently dropped an unrelated `identifier` key,
// since every bankDetails field is optional and zod strips unknown keys instead of failing).
const rawDetails = z.record(z.string(), z.unknown());

export const paymentMethodInput = z
  .object({
    displayName: z.string().trim().min(1, 'Add a display name.').max(200),
    type: z.enum(PAYMENT_METHOD_TYPES),
    currency: currency.nullish(),
    details: rawDetails.default({}),
    active: z.boolean().default(true),
  })
  .transform((v) => ({ ...v, details: v.type === 'bank_transfer' ? bankDetails.parse(v.details) : genericDetails.parse(v.details) }));

export const paymentMethodPatch = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  type: z.enum(PAYMENT_METHOD_TYPES).optional(),
  currency: currency.nullish(),
  details: rawDetails.optional(),
  active: z.boolean().optional(),
});

export const reorderInput = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

export type PaymentMethodInput = z.infer<typeof paymentMethodInput>;
export type PaymentMethodPatch = z.infer<typeof paymentMethodPatch>;
export type BankDetails = z.infer<typeof bankDetails>;
export type GenericDetails = z.infer<typeof genericDetails>;
