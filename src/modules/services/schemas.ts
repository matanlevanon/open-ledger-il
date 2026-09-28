import { z } from 'zod';
import { partialWithoutDefaults } from '../../core/schema';
import { currency } from '../documents/schemas';

export const SERVICE_UNITS = ['hour', 'day', 'month', 'project', 'item'] as const;
export type ServiceUnit = (typeof SERVICE_UNITS)[number];

export const VAT_TREATMENTS = ['standard', 'exempt', 'zero_rated'] as const;
export type VatTreatment = (typeof VAT_TREATMENTS)[number];

const text = (max: number) => z.string().trim().max(max).nullish();
const minor = z.number().int().refine(Number.isSafeInteger, 'Amount is too large.');

export const serviceInput = z.object({
  nameEn: z.string().trim().min(1, 'Add the English name.').max(200),
  nameHe: text(200),
  descriptionEn: text(2000),
  descriptionHe: text(2000),
  unitPriceMinor: minor.min(0),
  currency: currency.default('ILS'),
  defaultQuantityMilli: z.number().int().positive().default(1000),
  unit: z.enum(SERVICE_UNITS).default('item'),
  vatTreatment: z.enum(VAT_TREATMENTS).default('standard'),
  active: z.boolean().default(true),
});

export const servicePatch = partialWithoutDefaults(serviceInput);

export const reorderInput = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

export type ServiceInput = z.infer<typeof serviceInput>;
export type ServicePatch = z.infer<typeof servicePatch>;
