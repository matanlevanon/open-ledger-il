import type { Currency } from '../../core/money';

/**
 * Input contract for `renderDocument`. Kept independent of the `documents` row shape so this
 * module renders standalone in tests. `loadRenderDocument` in `store.ts` builds one of these
 * from the database for the preview route and for render-and-store.
 */

export type RenderVariant = 'filed' | 'client';

export type PaymentMethod = 'bank_transfer' | 'card' | 'cheque' | 'cash' | 'other';

export interface RenderLine {
  position: number;
  descriptionEn: string;
  descriptionHe: string | null;
  /** The optional description line (R18 task 4), printed smaller and muted below the item name. */
  detailEn: string | null;
  detailHe: string | null;
  /** Thousandths of a unit. 1000 = 1, per src/core/db conventions. */
  quantityMilli: number;
  unitPriceMinor: number;
  discountMinor: number;
  lineTotalMinor: number;
}

/** A payment_methods catalog row, resolved (R17 task 2), for the header table or the "Payment transfer method" block. */
export interface RenderPaymentMethod {
  displayName: string;
  type: 'bank_transfer' | 'bit' | 'paybox' | 'paypal' | 'card' | 'cash' | 'cheque' | 'other';
  details: Record<string, string | null>;
}

export interface RenderPayment {
  method: PaymentMethod;
  /** The catalog entry actually used, when one was chosen (R17 task 2), for the payment method table. */
  methodDetail: RenderPaymentMethod | null;
  paidOn: string;
  reference: string | null;
  amountMinor: number;
  /** null when the document's own currency is already ILS, or no rate was resolved. */
  amountIlsMinor: number | null;
  currency: Currency;
}

export interface RenderClient {
  nameEn: string;
  nameHe: string | null;
  companyId: string | null;
  vatNumber: string | null;
  country: string;
  foreignResident: boolean;
  addressEn: string | null;
  addressHe: string | null;
}

export interface RenderBusiness {
  nameEn: string;
  nameHe: string;
  taglineEn: string | null;
  taglineHe: string | null;
  addressEn: string | null;
  addressHe: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  bankDetails: string | null;
  /** Business tax id (ת"ז or ח.פ) from Settings > Business, OWNER_TAX_ID secret as fallback. Printed on documents, never logged. */
  taxId: string | null;
  /** Uploaded logo as a data URI. Null prints the default wordmark. */
  logoDataUri?: string | null;
  /** Uploaded signature image as a data URI. Null prints no signature image. */
  signatureDataUri?: string | null;
}

/** The document this one was created from (R17 task 6's "Created from:" line), when linked. */
export interface RenderSource {
  typeNameEn: string;
  typeNameHe: string;
  number: number | null;
}

export interface RenderDocument {
  id: number;
  seriesId: string;
  type: string;
  typeNameEn: string;
  typeNameHe: string;
  /** document_types.kind ('quote', 'demand', 'receipt', ...). Gates the payment instructions block (R16 task 7). */
  kind: string;
  /** null before finalize: the preview route renders drafts with no number. */
  number: number | null;
  status: string;
  legalMode: 'patur' | 'murshe';
  /**
   * documents.lang_variant (R18 task 3). 'en': client copy is English, filed copy is one
   * bilingual document (English layout, every label carrying its Hebrew). 'bilingual': the
   * document is a Hebrew document; both the client and the filed copy render the Hebrew layout,
   * under the shared header from R18 task 1.
   */
  langVariant: 'en' | 'bilingual';
  date: string;
  issuanceDate: string | null;
  currency: Currency;
  fxRate: string | null;
  fxRateDate: string | null;
  fxRateLabel: string | null;
  subtotalMinor: number;
  vatRateBp: number | null;
  vatAmountMinor: number;
  totalMinor: number;
  /** null hides the ILS line, per docs/currency-and-fx.md. */
  totalIlsMinor: number | null;
  allocationNumber: string | null;
  /** R12's allocationGate print_note (CLAUDE.md rule 3, spec §2.2.2 choices 2 and 3): printed in bold when set. */
  printNote: 'no_input_vat' | 'reverse_charge' | null;
  notes: string | null;
  /** The free-text note next to the payment methods multi-select (R16 task 7 field, repurposed by R17 task 2). */
  paymentInstructions: string | null;
  /** The document's payment methods multi-select, resolved (R17 task 2): the "Payment transfer method" section. */
  paymentMethods: RenderPaymentMethod[];
  /** True for the first PDF rendered of this variant ("מקור"), false for a later reprint. */
  isOriginal: boolean;
  /** The document this one converted from, when linked (R17 task 6). */
  source: RenderSource | null;
  lines: RenderLine[];
  payments: RenderPayment[];
  client: RenderClient | null;
  business: RenderBusiness;
}
