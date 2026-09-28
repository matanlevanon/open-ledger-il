export type Lang = 'en' | 'he';

/** UI copy for the PDF templates. English text follows CLAUDE.md: short, active, no em dashes. */
export const LABELS: Record<Lang, Record<string, string>> = {
  en: {
    date: 'Date',
    client: 'Client',
    country: 'Country',
    description: 'Description',
    qty: 'Qty',
    unitPrice: 'Unit price',
    discount: 'Discount',
    lineTotal: 'Line total',
    subtotal: 'Subtotal',
    vat: 'VAT',
    total: 'Total',
    totalIls: 'Total in ILS',
    exchangeRate: 'Exchange rate',
    documentExchangeRate: 'Document exchange rate',
    rateDate: 'Rate date',
    paymentDetails: 'Payment details',
    paymentInstructions: 'Payment instructions',
    paymentMethod: 'Payment method',
    paymentTransferMethod: 'Payment transfer method',
    paymentsRecorded: 'Payments recorded',
    method: 'Method',
    reference: 'Reference',
    amount: 'Amount',
    allocationNumber: 'Allocation number',
    businessId: 'Business ID',
    draft: 'Draft, not yet issued',
    notes: 'Notes',
    page: 'Page',
    of: 'of',
    signedBy: 'Signed by',
    signature: 'Signature',
    notTaxInvoice: 'This is not a tax invoice',
    digitallySigned: 'Digitally signed',
    createdFrom: 'Created from',
    createdAndSignedUsing: 'This document was created and digitally signed using Open Ledger IL',
    to: 'To',
  },
  he: {
    date: 'תאריך',
    client: 'לקוח',
    country: 'מדינה',
    description: 'תיאור',
    qty: 'כמות',
    unitPrice: 'מחיר יחידה',
    discount: 'הנחה',
    lineTotal: 'סה"כ שורה',
    subtotal: 'סכום ביניים',
    vat: 'מע"מ',
    total: 'סה"כ לתשלום',
    totalIls: 'סה"כ בשקלים',
    exchangeRate: 'שער חליפין',
    documentExchangeRate: 'שער חליפין למסמך',
    rateDate: 'תאריך שער',
    paymentDetails: 'פרטי תשלום',
    paymentInstructions: 'הוראות תשלום',
    paymentMethod: 'אמצעי תשלום',
    paymentTransferMethod: 'אמצעי העברת תשלום',
    paymentsRecorded: 'תשלומים שנרשמו',
    method: 'אמצעי תשלום',
    reference: 'אסמכתא',
    amount: 'סכום',
    allocationNumber: 'מספר הקצאה',
    businessId: 'מספר עוסק',
    draft: 'טיוטה, טרם הופקה',
    notes: 'הערות',
    page: 'עמוד',
    of: 'מתוך',
    signedBy: 'נחתם על ידי',
    signature: 'חתימה',
    notTaxInvoice: 'אינו חשבונית מס',
    digitallySigned: 'נחתם דיגיטלית',
    createdFrom: 'נוצר מתוך',
    createdAndSignedUsing: 'מסמך זה נוצר ונחתם דיגיטלית באמצעות Open Ledger IL',
    to: 'לכבוד',
  },
};

export const PAYMENT_METHOD_LABELS: Record<Lang, Record<string, string>> = {
  en: {
    bank_transfer: 'Bank transfer',
    card: 'Card',
    cheque: 'Cheque',
    cash: 'Cash',
    other: 'Other',
  },
  he: {
    bank_transfer: 'העברה בנקאית',
    card: 'כרטיס אשראי',
    cheque: "צ'ק",
    cash: 'מזומן',
    other: 'אחר',
  },
};

export function copyLabel(lang: Lang, isOriginal: boolean): string {
  if (isOriginal) return lang === 'he' ? 'מקור' : 'Original (מקור)';
  return lang === 'he' ? 'העתק נאמן למקור' : 'True copy of the original (העתק נאמן למקור)';
}

export function computerizedLabel(lang: Lang): string {
  return lang === 'he' ? 'מסמך ממוחשב' : 'Computerized document (מסמך ממוחשב)';
}

export function allocationLabel(lang: Lang): string {
  return lang === 'he' ? 'מספר הקצאה:' : 'Allocation number (מספר הקצאה:)';
}

/**
 * R12's allocationGate print_note, printed in bold (docs/israel-invoices-api.md §2.2.2, choices
 * 2 and 3). The Hebrew is the wording the spec requires; the English is a plain-language gloss,
 * following the bilingual pattern of copyLabel and computerizedLabel above.
 */
export function printNoteText(note: 'no_input_vat' | 'reverse_charge'): string {
  return note === 'no_input_vat'
    ? 'No input VAT may be deducted for this invoice (אין לנכות מס תשומות בגין חשבונית זו)'
    : 'The client must report a self invoice for this invoice (בגין חשבונית זו לקוח חייב לדווח חשבונית עצמית)';
}
