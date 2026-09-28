import type { WaveCustomerField, WaveCustomerMapping, WaveInvoiceField, WaveInvoiceMapping } from './types';

/** Candidate header names per target field, checked case-insensitively, exact match first. */
const CUSTOMER_CANDIDATES: Record<WaveCustomerField, string[]> = {
  nameEn: ['customer name', 'name', 'business name', 'company name'],
  nameHe: ['hebrew name', 'name (hebrew)'],
  companyId: ['business number', 'company id', 'tax id', 'tax number', 'id number', 'registration number'],
  vatNumber: ['vat number', 'vat id'],
  country: ['country'],
  currency: ['currency', 'default currency'],
  email: ['email', 'email address'],
  phone: ['phone', 'phone number', 'mobile'],
  addressEn: ['address', 'billing address', 'street address'],
  notes: ['notes', 'memo', 'comments'],
};

const INVOICE_CANDIDATES: Record<WaveInvoiceField, string[]> = {
  externalId: ['invoice number', 'invoice #', 'invoice no', 'number'],
  clientName: ['customer', 'customer name', 'client', 'client name'],
  docNumber: ['invoice number', 'invoice #', 'invoice no', 'number'],
  docDate: ['invoice date', 'date'],
  currency: ['currency'],
  amount: ['amount', 'total', 'total amount', 'amount due', 'invoice total'],
  status: ['status'],
};

function guess<F extends string>(headers: string[], candidates: Record<F, string[]>): Partial<Record<F, string | null>> {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const result: Partial<Record<F, string | null>> = {};
  for (const field of Object.keys(candidates) as F[]) {
    const names = candidates[field];
    const idx = lower.findIndex((h) => names.includes(h));
    result[field] = idx === -1 ? null : headers[idx]!;
  }
  return result;
}

export function guessCustomerMapping(headers: string[]): WaveCustomerMapping {
  return guess(headers, CUSTOMER_CANDIDATES);
}

export function guessInvoiceMapping(headers: string[]): WaveInvoiceMapping {
  return guess(headers, INVOICE_CANDIDATES);
}
