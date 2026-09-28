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
