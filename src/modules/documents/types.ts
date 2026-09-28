import { all, first } from '../../core/db';
import { NotFoundError } from '../../core/errors';

export type DocKind = 'quote' | 'demand' | 'receipt' | 'credit' | 'invoice' | 'invoice_receipt' | 'credit_invoice';

export interface DocTypeRow {
  code: string;
  name_en: string;
  name_he: string;
  kind: DocKind;
  modes: 'both' | 'patur' | 'murshe';
  bookkeeping: number;
  credit_type: string | null;
  sort_order: number;
  enabled: number;
}

/**
 * Which document can be created from which. R11 adds the מורשה flows.
 * `payment` links count against the source's open balance. `converted` links close a quote
 * or move a demand's balance to the new demand.
 */
export const CONVERSIONS: Record<string, { to: string; kind: 'converted' | 'payment' }[]> = {
  // R18 task 10: 300 is the one proforma type now (PF is disabled for new documents, see below),
  // so a new quote converts to it directly; there is no separate PF target to offer any more.
  QT: [
    { to: 'PR', kind: 'converted' },
    { to: '300', kind: 'converted' },
    { to: '400', kind: 'converted' },
  ],
  PR: [
    { to: '300', kind: 'converted' },
    { to: '400', kind: 'payment' },
    { to: '320', kind: 'payment' },
  ],
  // PF (R17 task 4) is disabled for new documents (R18 task 10) but this stays: an
  // already-finalized PF can still convert into the real billing document with its lines and
  // agreed rate carried over (insertDraft's `convert` path), the same as 300, the type that took
  // over its role.
  PF: [
    { to: '300', kind: 'converted' },
    { to: '400', kind: 'payment' },
    { to: '320', kind: 'payment' },
  ],
  // The pro forma / transaction invoice (R01, renamed and merged with PF's behaviour in R18 task
  // 10): behaves like a payment request, converting into the real billing document with its
  // lines and agreed rate carried over.
  '300': [
    { to: '400', kind: 'payment' },
    { to: '320', kind: 'payment' },
  ],
  // A plain receipt stays possible against a standalone tax invoice once switched: 305 then a
  // 400 receipt, alongside the combined 320 (docs/legal-requirements.md's default flow uses 320,
  // but 400 is never retired, see runs/R11-murshe.md fix 1).
  '305': [{ to: '400', kind: 'payment' }],
  // A 332 advance-approval invoice converts into the real tax invoice the client is billed with,
  // action 4 reusing its own invoice_id (src/modules/ita/service.ts isProformaConversion,
  // docs/israel-invoices-api.md §5 "action"). 'converted', not 'payment': the 332 itself carries
  // no payments to hand over.
  '332': [
    { to: '305', kind: 'converted' },
    { to: '320', kind: 'converted' },
  ],
};

/** Types that stay revisable after finalize until converted, when the setting allows it. */
export const REVISABLE_TYPES = ['QT', 'PR'];

/** Receipt types, whose payments are money in and pass the ceiling hook. */
export const RECEIPT_TYPES = ['400'];

export async function listTypes(db: D1Database): Promise<DocTypeRow[]> {
  return all<DocTypeRow>(db, 'SELECT * FROM document_types ORDER BY sort_order');
}

export async function getType(db: D1Database, code: string): Promise<DocTypeRow> {
  const row = await first<DocTypeRow>(db, 'SELECT * FROM document_types WHERE code = ?', code);
  if (!row) throw new NotFoundError('Document type', code);
  return row;
}

/** Display number such as "PR-0088". */
export function displayNumber(type: string, number: number | null | undefined): string | null {
  if (number === null || number === undefined) return null;
  return `${type}-${String(number).padStart(4, '0')}`;
}
