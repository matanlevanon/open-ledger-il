import type { ItaIdentity } from './config';

/**
 * Builds v2 request bodies. Every field name is lowercase (CLAUDE.md rule 8).
 * Amounts are integer agorot in the ledger. The ITA wants N12.2 numbers, so they are written
 * from the integer's digits, never computed with float math.
 */

export interface AllocationLine {
  position: number;
  description: string;
  quantityMilli: number;
  unitPriceMinor: number;
  discountMinor: number;
  lineTotalMinor: number;
}

/** What the ITA needs from a numbered document. Amounts in ILS agorot. */
export interface AllocationDocument {
  id: number;
  type: string;
  number: number | null;
  status: string;
  date: string;
  issuanceDate: string;
  customerVatNumber: string;
  customerName: string | null;
  amountBeforeDiscountMinor: number;
  discountMinor: number;
  paymentAmountMinor: number;
  vatAmountMinor: number;
  totalMinor: number;
  vatRateBp: number | null;
  lines: AllocationLine[];
  /** The 332 advance-approval document this tax invoice was converted from, if any. */
  proformaDocumentId: number | null;
}

/** Integer agorot to an N12.2 JSON number, through its decimal text. */
export function n122(minor: number): number {
  if (!Number.isSafeInteger(minor)) throw new RangeError(`Amount must be integer agorot, got ${minor}`);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return Number(`${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`);
}

/** Thousandths to an N12.2 quantity, rounded half away from zero at the second decimal. */
function quantity(milli: number): number {
  const abs = Math.abs(milli);
  const hundredths = Math.trunc(abs / 10) + (abs % 10 >= 5 ? 1 : 0);
  return n122(milli < 0 ? -hundredths : hundredths);
}

/** Basis points to a VAT rate number (1800 to 18). */
function vatRate(bp: number): number {
  return n122(bp);
}

export interface ApprovalOptions {
  invoiceId: string;
  /** 3 reverse charge, 4 tax invoice born from a 332. */
  action?: 3 | 4;
}

export function buildApprovalBody(doc: AllocationDocument, identity: ItaIdentity, opts: ApprovalOptions): Record<string, unknown> {
  if (doc.number === null) throw new RangeError('The document has no number yet. The number comes before the ITA call.');
  const body: Record<string, unknown> = {
    invoice_id: opts.invoiceId,
    invoice_type: Number(doc.type),
    vat_number: Number(identity.vatNumber),
    user_id: Number(identity.userId),
    invoice_reference_number: String(doc.number),
    customer_vat_number: Number(doc.customerVatNumber),
    invoice_date: doc.date,
    invoice_issuance_date: doc.issuanceDate,
    accounting_software_number: Number(identity.accountingSoftwareNumber),
    amount_before_discount: n122(doc.amountBeforeDiscountMinor),
    discount: n122(doc.discountMinor),
    payment_amount: n122(doc.paymentAmountMinor),
    vat_amount: n122(doc.vatAmountMinor),
    payment_amount_including_vat: n122(doc.totalMinor),
  };
  if (doc.customerName) body.customer_name = doc.customerName.slice(0, 25);
  if (opts.action !== undefined) body.action = opts.action;
  if (doc.lines.length > 0) {
    body.items = doc.lines.map((l) => {
      const item: Record<string, unknown> = {
        index: l.position,
        description: l.description.slice(0, 30),
        quantity: quantity(l.quantityMilli),
        price_per_unit: n122(l.unitPriceMinor),
        discount: n122(l.discountMinor),
        total_amount: n122(l.lineTotalMinor),
      };
      if (doc.vatRateBp !== null) item.vat_rate = vatRate(doc.vatRateBp);
      return item;
    });
  }
  return body;
}

/** Table 2.6 summary plus the invoice list. */
export function buildMultiApprovalBody(bodies: Record<string, unknown>[], identity: ItaIdentity, docs: AllocationDocument[]) {
  return {
    vat_number: Number(identity.vatNumber),
    user_id: Number(identity.userId),
    invoices_amount: bodies.length,
    invoices_payment_amount: n122(docs.reduce((s, d) => s + d.paymentAmountMinor, 0)),
    invoices_vat_amount: n122(docs.reduce((s, d) => s + d.vatAmountMinor, 0)),
    invoices_list: bodies,
  };
}

/** Table 4.1: the body of Cancel, Continue and FurtherObjection. */
export function buildDecisionBody(invoiceId: string, identity: ItaIdentity) {
  return {
    invoice_id: invoiceId,
    vat_number: Number(identity.vatNumber),
    user_id: Number(identity.userId),
    accounting_software_number: Number(identity.accountingSoftwareNumber),
  };
}
