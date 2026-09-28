import { z } from 'zod';
import { currency } from '../documents/schemas';

export const PAYMENT_METHOD_TYPES = ['bank_transfer', 'bit', 'paybox', 'paypal', 'card', 'cash', 'cheque', 'other'] as const;
export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

const text = (max: number) => z.string().trim().max(max).nullish();

/** Bank transfer's own fields (task 2); bank address only matters for a foreign transfer, but it is never required. */
export const bankDetails = z.object({
  bankName: text(200),
  bankNumber: text(20),
  branch: text(20),
  accountNumber: text(40),
  accountHolder: text(200),
  iban: text(50),
  swiftBic: text(20),
  bankAddress: text(500),
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
