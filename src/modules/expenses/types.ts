import { z } from 'zod';
import { CURRENCY_CODES } from '../../core/money';

export const EXPENSE_STATUSES = ['new', 'filed', 'not_expense', 'duplicate', 'returned'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const MONEY_MAJOR = z.string().regex(/^\d+(\.\d{1,6})?$/, 'Use a plain decimal amount, for example 123.45');
const CURRENCY = z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.enum(CURRENCY_CODES as [string, ...string[]]));

/**
 * What an Extractor returns for one file. Amounts are decimal strings (money.ts rule: never
 * floats), matching the field order from runs/R07-expenses.md: supplier name, supplier ID,
 * document number, date, currency, amount, VAT amount, document type.
 */
export const ExtractedExpenseSchema = z.object({
  supplierName: z.string().trim().min(1),
  supplierId: z.string().trim().min(1).nullable().optional(),
  documentNumber: z.string().trim().min(1).nullable().optional(),
  date: DATE.nullable().optional(),
  currency: CURRENCY,
  amount: MONEY_MAJOR,
  vatAmount: MONEY_MAJOR.nullable().optional(),
  documentType: z.string().trim().min(1).nullable().optional(),
});
export type ExtractedExpense = z.infer<typeof ExtractedExpenseSchema>;

export const SupplierInputSchema = z.object({
  name: z.string().trim().min(1),
  taxId: z.string().trim().min(1).nullable().optional(),
  country: z.string().trim().length(2).optional(),
  defaultCategoryId: z.number().int().positive().nullable().optional(),
  defaultCurrency: CURRENCY.optional(),
  notes: z.string().trim().nullable().optional(),
});
export type SupplierInput = z.infer<typeof SupplierInputSchema>;

export const CategoryInputSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, digits and underscores'),
  nameEn: z.string().trim().min(1),
  sortOrder: z.number().int().optional(),
});
export type CategoryInput = z.infer<typeof CategoryInputSchema>;

export const CategoryUpdateSchema = z.object({
  nameEn: z.string().trim().min(1).optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});

/** Fields an owner may edit on the review screen. */
export const ExpenseUpdateSchema = z.object({
  supplierId: z.number().int().positive().nullable().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  documentNumber: z.string().trim().min(1).nullable().optional(),
  documentDate: DATE.nullable().optional(),
  documentType: z.string().trim().nullable().optional(),
  currency: CURRENCY.optional(),
  amount: MONEY_MAJOR.optional(),
  vatAmount: MONEY_MAJOR.nullable().optional(),
  fxRateOverride: z
    .string()
    .regex(/^\d{1,6}(\.\d{1,6})?$/)
    .nullable()
    .optional(),
  notes: z.string().trim().nullable().optional(),
});
export type ExpenseUpdate = z.infer<typeof ExpenseUpdateSchema>;

/** Fields an accountant may touch (runs/R09-accountant.md: status, category and notes only). */
export const ExpenseAccountantUpdateSchema = z.object({
  categoryId: z.number().int().positive().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

export const StatusUpdateSchema = z
  .object({
    status: z.enum(EXPENSE_STATUSES),
    reason: z.string().trim().min(1).nullable().optional(),
  })
  .refine((v) => v.status !== 'returned' || Boolean(v.reason), {
    message: 'A returned expense needs a reason.',
    path: ['reason'],
  });
export type StatusUpdate = z.infer<typeof StatusUpdateSchema>;

export interface ExpenseRow {
  id: number;
  /** Joined from suppliers in the list query only. */
  supplier_name?: string | null;
  supplier_tax_id?: string | null;
  category_name?: string | null;
  file_id: number | null;
  supplier_id: number | null;
  category_id: number | null;
  status: ExpenseStatus;
  status_reason: string | null;
  duplicate_of_id: number | null;
  document_number: string | null;
  document_date: string | null;
  document_type: string | null;
  currency: string;
  amount_minor: number;
  vat_amount_minor: number;
  input_vat_reclaimable: number;
  allocation_number: string | null;
  amount_ils_minor: number | null;
  fx_rate: string | null;
  fx_rate_date: string | null;
  fx_source: string | null;
  extracted_json: string | null;
  /** R20: fixed (1) or one-off (0) from the index sheet. Null when unknown. */
  is_fixed: number | null;
  notes: string | null;
  reviewed_at: string | null;
  reviewed_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierRow {
  id: number;
  name: string;
  tax_id: string | null;
  country: string;
  default_category_id: number | null;
  default_currency: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CategoryRow {
  id: number;
  key: string;
  name_en: string;
  sort_order: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface ExpenseFileRow {
  id: number;
  source: 'drive' | 'upload';
  drive_file_id: string | null;
  r2_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  expense_id: number | null;
  ingested_at: string;
}
