import { z } from 'zod';
import { dateString } from '../documents/schemas';
import { isValidIsraeliId } from './israeli-id';

export const businessPatch = z.object({
  nameEn: z.string().trim().min(1).max(200).optional(),
  nameHe: z.string().trim().min(1).max(200).optional(),
  taglineEn: z.string().trim().max(200).nullish(),
  taglineHe: z.string().trim().max(200).nullish(),
  addressEn: z.string().trim().max(500).nullish(),
  addressHe: z.string().trim().max(500).nullish(),
  taxId: z
    .string()
    .trim()
    .refine((v) => v === '' || isValidIsraeliId(v), 'Enter a valid Israeli ID or company number (9 digits).')
    .nullish(),
  email: z.string().trim().email().nullish(),
  phone: z.string().trim().max(50).nullish(),
  website: z.string().trim().max(300).nullish(),
  bankDetails: z.string().trim().max(2000).nullish(),
  paymentLinkStripe: z.string().trim().max(500).nullish(),
  paymentLinkPaypal: z.string().trim().max(500).nullish(),
});

export const startNumberInput = z.object({
  startNumber: z.number().int().min(1),
});

export const ceilingInput = z.object({
  year: z.number().int().min(2000).max(2100),
  amountMinor: z.number().int().positive(),
  currency: z.string().trim().min(3).max(3).default('ILS'),
  note: z.string().trim().max(500).nullish(),
});

export const vatRateInput = z.object({
  rateBp: z.number().int().min(0).max(10000),
  effectiveFrom: dateString,
  note: z.string().trim().max(500).nullish(),
});

export const signatureModeInput = z.object({
  mode: z.enum(['secured', 'none']),
});

export type BusinessPatch = z.infer<typeof businessPatch>;
export type StartNumberInput = z.infer<typeof startNumberInput>;
export type CeilingInput = z.infer<typeof ceilingInput>;
export type VatRateInput = z.infer<typeof vatRateInput>;
export type SignatureModeInput = z.infer<typeof signatureModeInput>;
