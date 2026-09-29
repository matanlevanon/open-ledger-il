import { all, first } from '../../core/db';
import { NotFoundError } from '../../core/errors';

/** Row shapes of the tables the documents module reads. */

export interface DocRow {
  id: number;
  type: string;
  series_id: string;
  number: number | null;
  status: 'draft' | 'awaiting_allocation' | 'allocation_pending' | 'allocation_refused' | 'final' | 'cancelled';
  legal_mode: string | null;
  client_id: number | null;
  date: string;
  issuance_date: string | null;
  due_date: string | null;
  currency: string;
  fx_rate: string | null;
  fx_rate_date: string | null;
  fx_source: string | null;
  subtotal_minor: number;
  vat_rate_bp: number | null;
  vat_amount_minor: number;
  total_minor: number;
  total_ils_minor: number | null;
  allocation_number: string | null;
  lang_variant: 'en' | 'bilingual';
  notes: string | null;
  payment_instructions: string | null;
  /** JSON array of payment_methods.id, the multi-select on a quote, payment request, proforma or transaction invoice (R17 task 2). */
  payment_method_ids: string | null;
  hash: string | null;
  prev_hash: string | null;
  pdf_hashes: string | null;
  finalized_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_by: number | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface LineRow {
  id: number;
  document_id: number;
  position: number;
  item_id: number | null;
  description_en: string;
  description_he: string | null;
  detail_en: string | null;
  detail_he: string | null;
  quantity_milli: number;
  unit_price_minor: number;
  discount_minor: number;
  line_total_minor: number;
}

export interface PaymentRow {
  id: number;
  document_id: number;
  method: 'bank_transfer' | 'card' | 'cheque' | 'cash' | 'other';
  /** The configured payment_methods.id actually used, for printing its details on the receipt (R17 task 2). */
  method_id: number | null;
  paid_on: string;
  reference: string | null;
  amount_minor: number;
  currency: string;
  fx_rate: string | null;
  fx_rate_date: string | null;
  fx_source: string | null;
  amount_ils_minor: number | null;
  cheque_crossed: number;
  bank_number: string | null;
  branch_number: string | null;
  account_number: string | null;
}

export interface MetaRow {
  document_id: number;
  source_id: number | null;
  source_kind: 'converted' | 'payment' | 'credit' | null;
  revises_id: number | null;
  show_ils: number;
  carry_rate: number;
  backdate_reason: string | null;
  credit_reason: string | null;
}

export interface LinkRow {
  id: number;
  source_id: number;
  target_id: number;
  kind: 'converted' | 'payment' | 'credit' | 'carried_rate';
  amount_minor: number | null;
  currency: string | null;
  created_at: string;
}

export interface EventRow {
  id: number;
  document_id: number;
  kind: string;
  at: string;
  user_id: number | null;
  user_email: string | null;
  details: string | null;
}

export interface LoadedDraft {
  doc: DocRow;
  lines: LineRow[];
  payments: PaymentRow[];
  meta: MetaRow | null;
}

export async function getDoc(db: D1Database, id: number): Promise<DocRow> {
  const row = await first<DocRow>(db, 'SELECT * FROM documents WHERE id = ?', id);
  if (!row) throw new NotFoundError('Document', id);
  return row;
}

export async function loadFull(db: D1Database, id: number): Promise<LoadedDraft> {
  const [doc, lines, payments, meta] = await Promise.all([
    getDoc(db, id),
    all<LineRow>(db, 'SELECT * FROM document_lines WHERE document_id = ? ORDER BY position', id),
    all<PaymentRow>(
      db,
      `SELECT p.*, COALESCE(pd.cheque_crossed, 0) AS cheque_crossed, pd.bank_number, pd.branch_number, pd.account_number
       FROM payments p LEFT JOIN payment_details pd ON pd.payment_id = p.id
       WHERE p.document_id = ? ORDER BY p.id`,
      id,
    ),
    first<MetaRow>(db, 'SELECT * FROM document_meta WHERE document_id = ?', id),
  ]);
  return { doc, lines, payments, meta };
}
