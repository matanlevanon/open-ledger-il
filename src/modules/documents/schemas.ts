import { z } from 'zod';
import { assertDate } from '../../core/db';
import { CURRENCY_CODES, parseRate } from '../../core/money';
import { partialWithoutDefaults } from '../../core/schema';

export const dateString = z.string().refine((v) => {
  try {
    assertDate(v);
    return true;
  } catch {
    return false;
  }
}, 'Use a real date in YYYY-MM-DD form.');

export const currency = z.enum(CURRENCY_CODES as [string, ...string[]]);

export const rateString = z.string().refine((v) => {
  try {
    parseRate(v);
    return true;
  } catch {
    return false;
  }
}, 'Use a rate above zero with up to 6 decimals.');

const minor = z.number().int().refine(Number.isSafeInteger, 'Amount is too large.');

export const lineInput = z.object({
  description: z.string().trim().min(1, 'Add a description.').max(2000),
  descriptionHe: z.string().trim().max(2000).nullish(),
  /** R18 task 4: an optional line beneath the item name, carried from the service catalog's own description. */
  detail: z.string().trim().max(2000).nullish(),
  detailHe: z.string().trim().max(2000).nullish(),
  itemId: z.number().int().positive().nullish(),
  quantityMilli: z.number().int().positive().default(1000),
  unitPriceMinor: minor,
  discountMinor: minor.min(0).default(0),
});

export const PAYMENT_METHODS = ['bank_transfer', 'card', 'cheque', 'cash', 'other'] as const;

export const paymentInput = z.object({
  method: z.enum(PAYMENT_METHODS),
  /** The catalog entry actually used (R17 task 2), printed on the receipt. Optional: `method` alone still works for a document with no catalog set up. */
  methodId: z.number().int().positive().nullish(),
  paidOn: dateString,
  reference: z.string().trim().max(200).nullish(),
  amountMinor: minor,
  chequeCrossed: z.boolean().default(false),
  /** Cheque bank details (unified file D120 fields 1307 to 1309). Digits only. */
  bankNumber: z.string().trim().regex(/^\d{1,10}$/).nullish(),
  branchNumber: z.string().trim().regex(/^\d{1,10}$/).nullish(),
  accountNumber: z.string().trim().regex(/^\d{1,15}$/).nullish(),
});

export const draftInput = z.object({
  type: z.string().min(1),
  clientId: z.number().int().positive().nullish(),
  date: dateString.optional(),
  dueDate: dateString.nullish(),
  currency: currency.optional(),
  notes: z.string().max(5000).nullish(),
  /** The free-text note next to the payment methods multi-select (R16 task 7 field, repurposed by R17 task 2). Saved back to the client on finalize. */
  paymentInstructions: z.string().max(5000).nullish(),
  /** The payment methods multi-select on a quote, payment request, proforma or transaction invoice (R17 task 2). Saved back to the client on finalize like paymentInstructions. */
  paymentMethodIds: z.array(z.number().int().positive()).max(20).default([]),
  langVariant: z.enum(['en', 'bilingual']).optional(),
  lines: z.array(lineInput).max(200).default([]),
  payments: z.array(paymentInput).max(50).default([]),
  showIls: z.boolean().default(false),
  overrideRate: rateString.nullish(),
  /** The day overrideRate belongs to, shown next to it. Optional. */
  overrideRateDate: dateString.nullish(),
  /** Receipt only: convert each payment at the Bank of Israel rate of its day, not the source document's rate. */
  latestRate: z.boolean().default(false),
  carryRate: z.boolean().default(false),
});

export const draftPatch = partialWithoutDefaults(draftInput.omit({ type: true }));

export const convertInput = z.object({
  type: z.string().min(1),
  date: dateString.optional(),
});

export const finalizeInput = z.object({
  backdateReason: z.string().trim().max(500).nullish(),
});

export const recordPaymentInput = z.object({
  date: dateString.optional(),
  payments: z.array(paymentInput).min(1).max(50),
  notes: z.string().max(5000).nullish(),
  finalize: z.boolean().default(true),
  backdateReason: z.string().trim().max(500).nullish(),
  /** A rate typed for this receipt, foreign currency only. Without it each payment takes the Bank of Israel rate of its day. */
  overrideRate: rateString.nullish(),
  /** Convert at the Bank of Israel rate of the payment day instead of this document's rate. */
  latestRate: z.boolean().default(false),
});

export const cancelInput = z.object({
  reason: z.string().trim().min(1, 'Add a reason.').max(500),
});

export const creditInput = z.object({
  mode: z.enum(['full', 'partial']),
  amountMinor: minor.positive().optional(),
  date: dateString.optional(),
  reason: z.string().trim().max(500).nullish(),
  refundMethod: z.enum(PAYMENT_METHODS).optional(),
  finalize: z.boolean().default(true),
  backdateReason: z.string().trim().max(500).nullish(),
});

export const sentInput = z.object({
  channel: z.enum(['email', 'whatsapp', 'print', 'other']).default('other'),
  to: z.string().trim().max(300).nullish(),
});

export const listQuery = z.object({
  tab: z.enum(['unpaid', 'draft', 'all']).default('all'),
  type: z.string().optional(),
  kind: z.string().optional(),
  clientId: z.coerce.number().int().positive().optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export type DraftInput = z.infer<typeof draftInput>;
export type DraftPatch = z.infer<typeof draftPatch>;
export type LineInput = z.infer<typeof lineInput>;
export type PaymentInput = z.infer<typeof paymentInput>;
