import { thresholdOn } from '../../core/config';
import { assertDate } from '../../core/db';
import { ValidationError } from '../../core/errors';
import { ItaClient } from './client';
import { type ItaEnv, ITA_PATHS, itaIdentity } from './config';
import { ItaReconnectError, ItaUnavailableError } from './errors';
import { n122 } from './payload';
import { readErrors, shortAllocationNumber } from './responses';
import { type ClockAndFetch, ItaTokenStore } from './tokens';

/**
 * Buyer side (docs/israel-invoices-api.md §9, addendum June 2026): check a supplier tax invoice
 * before deducting its input VAT. This business is the customer, so customer_vat_number is our own number.
 * R07 (expenses) calls these functions.
 */

export interface SupplierInvoiceDetails {
  invoice_type: number | null;
  vat_number: string | null;
  invoice_reference_number: string | null;
  customer_vat_number: string | null;
  customer_name: string | null;
  invoice_date: string | null;
  payment_amount: number | null;
  vat_amount: number | null;
  payment_amount_including_vat: number | null;
  confirmation_number: string | null;
}

export type BuyerLookup<T> = { found: true; data: T } | { found: false; code: string; message: string };

const NINE = /^\d{9}$/;

function client(env: ItaEnv, io: ClockAndFetch) {
  return new ItaClient(env, new ItaTokenStore(env, io), io);
}

function unwrap(result: Awaited<ReturnType<ItaClient['post']>>) {
  if (result.kind === 'unauthorized') throw new ItaReconnectError(result.message);
  if (result.kind === 'unavailable') throw new ItaUnavailableError(result.message);
  return result;
}

function notFound(json: unknown, status: number): { found: false; code: string; message: string } {
  const e = readErrors(json)[0];
  return { found: false, code: e?.code ?? `http_${status}`, message: 'The ITA has no invoice that matches these details.' };
}

/** Is a supplier invoice above the allocation threshold in force on its date? */
export async function supplierCheckRequired(db: D1Database, amountBeforeVatMinor: number, invoiceDate: string): Promise<boolean> {
  const threshold = await thresholdOn(db, 'allocation', assertDate(invoiceDate));
  return threshold !== null && amountBeforeVatMinor > threshold.amount_minor;
}

/** invoice-information/v2/details: the invoice behind an allocation number (full or 9 digits). */
export async function supplierInvoiceDetails(
  env: ItaEnv,
  io: ClockAndFetch,
  input: { supplier_vat_number: string; confirmation_number: string },
): Promise<BuyerLookup<SupplierInvoiceDetails>> {
  if (!NINE.test(input.supplier_vat_number)) throw new ValidationError('The supplier VAT number has 9 digits.');
  const confirmation = input.confirmation_number.replace(/\s/g, '');
  if (!/^\d{9,30}$/.test(confirmation)) throw new ValidationError('An allocation number has 9 to 30 digits.');
  const me = itaIdentity(env);
  const res = unwrap(
    await client(env, io).post(ITA_PATHS.details, {
      customer_vat_number: Number(me.vatNumber),
      confirmation_number: confirmation,
      vat_number: Number(input.supplier_vat_number),
    }),
  );
  const message = (res.json as { message?: unknown } | null)?.message;
  if (res.status !== 200 || !message || typeof message !== 'object' || readErrors(res.json).length > 0) {
    return notFound(res.json, res.status);
  }
  const m = message as Record<string, unknown>;
  const str = (v: unknown) => (v === undefined || v === null ? null : String(v));
  const num = (v: unknown) => (typeof v === 'number' ? v : v === undefined || v === null ? null : Number(v));
  return {
    found: true,
    data: {
      invoice_type: num(m.invoice_type),
      vat_number: str(m.vat_number),
      invoice_reference_number: str(m.invoice_reference_number),
      customer_vat_number: str(m.customer_vat_number),
      customer_name: str(m.customer_name),
      invoice_date: str(m.invoice_date),
      payment_amount: num(m.payment_amount),
      vat_amount: num(m.vat_amount),
      payment_amount_including_vat: num(m.payment_amount_including_vat),
      confirmation_number: str(m.confirmation_number),
    },
  };
}

/** invoice-information/v2/confirmationNumber: the allocation number behind a supplier invoice. */
export async function supplierConfirmationNumber(
  env: ItaEnv,
  io: ClockAndFetch,
  input: {
    supplier_vat_number: string;
    payment_amount_minor: number;
    vat_amount_minor: number;
    invoice_date: string;
    invoice_reference_number?: string;
  },
): Promise<BuyerLookup<{ confirmation_number: string; short_number: string }>> {
  if (!NINE.test(input.supplier_vat_number)) throw new ValidationError('The supplier VAT number has 9 digits.');
  assertDate(input.invoice_date, 'invoice_date');
  const me = itaIdentity(env);
  const body: Record<string, unknown> = {
    customer_vat_number: Number(me.vatNumber),
    vat_number: Number(input.supplier_vat_number),
    payment_amount: n122(input.payment_amount_minor),
    vat_amount: n122(input.vat_amount_minor),
    invoice_date: input.invoice_date,
  };
  if (input.invoice_reference_number) body.invoice_reference_number = input.invoice_reference_number.slice(0, 20);
  const res = unwrap(await client(env, io).post(ITA_PATHS.confirmationNumber, body));
  const raw = (res.json as { confirmation_number?: unknown } | null)?.confirmation_number;
  const value = raw === undefined || raw === null ? '' : String(raw);
  if (res.status !== 200 || !/^\d{9,}$/.test(value) || /^0+$/.test(value)) return notFound(res.json, res.status);
  return { found: true, data: { confirmation_number: value, short_number: shortAllocationNumber(value) } };
}
