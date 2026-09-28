/**
 * The document types an imported past document can have. The review screen offers these as a
 * pick list; `doc_type` stores the English name. Rows filed before the pick list keep the text
 * read from the PDF (English or Hebrew), which `externalKind` still classifies.
 */
export const EXTERNAL_DOC_TYPES = ['Quote', 'Payment Request', 'Pro Forma Invoice', 'Tax Invoice', 'Invoice/Receipt', 'Receipt', 'Credit'] as const;

export type ExternalKind = 'quote' | 'demand' | 'invoice' | 'receipt' | 'credit';

export function externalKind(docType: string): ExternalKind {
  const t = docType.toLowerCase();
  if (/pro ?forma|חשבון עסקה|payment request|דרישת תשלום/.test(t)) return 'demand';
  if (/quot|הצעת מחיר/.test(t)) return 'quote';
  if (/credit|זיכוי/.test(t)) return 'credit';
  if (/receipt|קבלה/.test(t)) return 'receipt';
  if (/invoice|חשבונית/.test(t)) return 'invoice';
  return 'receipt';
}

/**
 * `externalKind` as a SQL expression over a doc_type column, for reports summed in SQL.
 * LIKE ignores case for Latin letters, and Hebrew has no case.
 */
export function externalKindSql(col: string): string {
  const any = (...words: string[]) => words.map((w) => `${col} LIKE '%${w}%'`).join(' OR ');
  return `(CASE
    WHEN ${any('pro forma', 'proforma', 'חשבון עסקה', 'payment request', 'דרישת תשלום')} THEN 'demand'
    WHEN ${any('quot', 'הצעת מחיר')} THEN 'quote'
    WHEN ${any('credit', 'זיכוי')} THEN 'credit'
    WHEN ${any('receipt', 'קבלה')} THEN 'receipt'
    WHEN ${any('invoice', 'חשבונית')} THEN 'invoice'
    ELSE 'receipt' END)`;
}

/**
 * Imported documents that are income: receipts, invoice/receipts, tax invoices and credits.
 * A quote, payment request or pro forma is not income. The receipt that pays it is.
 */
export const externalIsIncomeSql = (col: string) => `${externalKindSql(col)} IN ('receipt', 'invoice', 'credit')`;

/** Imported documents that are money received: receipts, invoice/receipts and credits (refunds). */
export const externalIsCashSql = (col: string) => `${externalKindSql(col)} IN ('receipt', 'credit')`;

/** -1 for an imported credit, which is stored with a positive total, else 1. */
export const externalSignSql = (col: string) => `(CASE WHEN ${externalKindSql(col)} = 'credit' THEN -1 ELSE 1 END)`;
