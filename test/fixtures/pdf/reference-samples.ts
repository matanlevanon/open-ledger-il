import type { RenderDocument } from '../../../src/modules/pdf/types';

/**
 * Two reference fixtures (R17 task 6): an invoice/receipt in USD with ILS shown and a USD
 * proforma. Invented business, clients and numbers. Used by test/pdf/reference-samples.test.ts.
 */

/** A 1x1 transparent PNG, standing in for a signature uploaded in Settings > Signature. */
export const SAMPLE_SIGNATURE_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const business: RenderDocument['business'] = {
  nameEn: 'Sample Business Ltd',
  nameHe: 'עסק לדוגמה בע"מ',
  taglineEn: 'Design & Consulting',
  taglineHe: 'עיצוב וייעוץ',
  addressEn: '1 Example Street, Tel Aviv 6100000, Israel',
  addressHe: 'רחוב הדוגמה 1, תל אביב 6100000, ישראל',
  email: 'billing@example.com',
  phone: '+972-50-000-0000',
  website: 'example.com',
  bankDetails: null,
  taxId: '123456782',
  signatureDataUri: SAMPLE_SIGNATURE_DATA_URI,
};

export const referenceInvoiceReceipt: RenderDocument = {
  id: 1,
  seriesId: '400',
  type: '400',
  typeNameEn: 'Invoice/receipt',
  typeNameHe: 'חשבונית/קבלה',
  kind: 'receipt',
  number: 1042,
  status: 'final',
  legalMode: 'murshe',
  langVariant: 'en',
  date: '2026-09-23',
  issuanceDate: '2026-09-23',
  currency: 'USD',
  fxRate: '3.033000',
  fxRateDate: '2026-09-23',
  fxRateLabel: null,
  vatRateBp: null,
  vatAmountMinor: 0,
  allocationNumber: null,
  printNote: null,
  notes: null,
  paymentInstructions: null,
  paymentMethods: [],
  isOriginal: false,
  source: { typeNameEn: 'Price quotation', typeNameHe: 'הצעת מחיר', number: 101 },
  subtotalMinor: 33000,
  totalMinor: 33000,
  totalIlsMinor: 100089,
  lines: [
    {
      position: 1,
      descriptionEn: 'General',
      descriptionHe: 'כללי',
      detailEn: 'Monthly retainer, September 2026',
      detailHe: 'ריטיינר חודשי, ספטמבר 2026',
      quantityMilli: 6000,
      unitPriceMinor: 5000,
      discountMinor: 0,
      lineTotalMinor: 30000,
    },
    { position: 2, descriptionEn: 'Design review', descriptionHe: 'סקירת עיצוב', detailEn: null, detailHe: null, quantityMilli: 1000, unitPriceMinor: 3000, discountMinor: 0, lineTotalMinor: 3000 },
  ],
  payments: [
    {
      method: 'bank_transfer',
      methodDetail: { displayName: 'Bank transfer', type: 'bank_transfer', details: {} },
      paidOn: '2026-09-23',
      reference: null,
      amountMinor: 33000,
      amountIlsMinor: 100089,
      currency: 'USD',
    },
  ],
  client: {
    nameEn: 'Example Client',
    nameHe: 'לקוח לדוגמה',
    companyId: null,
    vatNumber: null,
    country: 'IL',
    foreignResident: false,
    addressEn: null,
    addressHe: null,
  },
  business,
};

// R18 task 10: 300 is the one proforma type now (merged with PF's own behaviour).
export const referenceProforma: RenderDocument = {
  id: 2,
  seriesId: '300',
  type: '300',
  typeNameEn: 'Pro Forma Invoice',
  typeNameHe: 'חשבון עסקה',
  kind: 'demand',
  number: 1043,
  status: 'final',
  legalMode: 'murshe',
  langVariant: 'en',
  date: '2026-09-01',
  issuanceDate: '2026-09-01',
  currency: 'USD',
  fxRate: '2.988000',
  fxRateDate: '2026-09-01',
  fxRateLabel: null,
  vatRateBp: null,
  vatAmountMinor: 0,
  allocationNumber: null,
  printNote: null,
  notes: null,
  paymentInstructions: null,
  paymentMethods: [
    {
      displayName: 'Bank account ILS',
      type: 'bank_transfer',
      details: { accountHolder: 'Sample Business Ltd', bankNumber: '99', bankName: 'Example Bank', branch: '001', accountNumber: '000000' },
    },
  ],
  isOriginal: true,
  source: null,
  subtotalMinor: 160000,
  totalMinor: 160000,
  totalIlsMinor: 478080,
  lines: [
    {
      position: 1,
      descriptionEn: 'Consulting Services',
      descriptionHe: 'שירותי ייעוץ',
      detailEn: 'Consulting retainer, Q4 2026',
      detailHe: 'ריטיינר ייעוץ, רבעון 4 2026',
      quantityMilli: 1000,
      unitPriceMinor: 150000,
      discountMinor: 0,
      lineTotalMinor: 150000,
    },
    { position: 2, descriptionEn: 'Workshop day', descriptionHe: 'יום סדנה', detailEn: null, detailHe: null, quantityMilli: 1000, unitPriceMinor: 10000, discountMinor: 0, lineTotalMinor: 10000 },
  ],
  payments: [],
  client: {
    nameEn: 'Acme Ltd',
    nameHe: 'אקמי בע"מ',
    companyId: null,
    vatNumber: null,
    country: 'IL',
    foreignResident: false,
    addressEn: null,
    addressHe: null,
  },
  business,
};

/** A Hebrew document (langVariant 'bilingual', R18 task 3): the same proforma, Hebrew client and content, one line with a description and one without (R18 task 4). */
export const referenceProformaHebrew: RenderDocument = {
  ...referenceProforma,
  id: 3,
  langVariant: 'bilingual',
  isOriginal: true,
  client: {
    nameEn: 'Acme Ltd',
    nameHe: 'אקמי בע"מ',
    companyId: null,
    vatNumber: '515123456',
    country: 'IL',
    foreignResident: false,
    addressEn: null,
    addressHe: 'רחוב הדוגמה 2, תל אביב',
  },
};

/**
 * R19 task 3: a Hebrew-only client (no nameEn) on an English document. The English client copy
 * and the bilingual filed copy both fall back to the Hebrew name; the filed copy shows it alone,
 * with no stray "/" separator.
 */
export const referenceHebrewOnlyClient: RenderDocument = {
  ...referenceInvoiceReceipt,
  id: 4,
  client: {
    ...referenceInvoiceReceipt.client!,
    nameEn: '',
    nameHe: 'דנה כהן',
  },
};

/**
 * R19 task 3: an English-only client (no nameHe) on a Hebrew document. The Hebrew (RTL) layout
 * falls back to the English name.
 */
export const referenceEnglishOnlyClient: RenderDocument = {
  ...referenceProformaHebrew,
  id: 5,
  client: {
    ...referenceProformaHebrew.client!,
    nameEn: 'Global Retail Co',
    nameHe: null,
  },
};
