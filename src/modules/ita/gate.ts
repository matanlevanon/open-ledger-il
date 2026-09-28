import { first } from '../../core/db';

/**
 * CLAUDE.md rule 3: no PDF of a qualifying tax invoice leaves the system before an allocation
 * number or a recorded refusal decision. Sending and PDF code (R02, R06) call `allocationGate`
 * before a document goes out.
 */

export type PrintNote = 'no_input_vat' | 'reverse_charge' | null;

export interface AllocationGate {
  allowed: boolean;
  reason:
    | 'not_requested'
    | 'number_granted'
    | 'decision_continue'
    | 'waiting_for_number'
    | 'waiting_for_choice'
    | 'cancelled';
  short_number: string | null;
  /** Text the PDF prints for the decision (spec §2.2.2): choice 2 and choice 3. */
  print_note: PrintNote;
}

export async function allocationGate(db: D1Database, documentId: number): Promise<AllocationGate> {
  const doc = await first<{ status: string }>(db, 'SELECT status FROM documents WHERE id = ?', documentId);
  const row = await first<{
    document_id: number;
    status: string;
    decision: string | null;
    short_number: string | null;
    replacement_document_id: number | null;
  }>(
    db,
    `SELECT document_id, status, decision, short_number, replacement_document_id FROM ita_allocations
     WHERE document_id = ? OR replacement_document_id = ? ORDER BY document_id = ? DESC LIMIT 1`,
    documentId,
    documentId,
    documentId,
  );
  const status = doc?.status ?? 'draft';
  const blocked = (reason: AllocationGate['reason']): AllocationGate => ({ allowed: false, reason, short_number: null, print_note: null });

  if (status === 'cancelled') return blocked('cancelled');
  if (status === 'awaiting_allocation' || status === 'allocation_pending') return blocked('waiting_for_number');
  if (status === 'allocation_refused') return blocked('waiting_for_choice');

  if (row && row.replacement_document_id === documentId) {
    return row.status === 'approved'
      ? { allowed: true, reason: 'number_granted', short_number: row.short_number, print_note: 'reverse_charge' }
      : blocked('waiting_for_number');
  }
  if (!row) return { allowed: true, reason: 'not_requested', short_number: null, print_note: null };
  if (row.status === 'approved') return { allowed: true, reason: 'number_granted', short_number: row.short_number, print_note: null };
  if (row.status === 'decided' && row.decision === 'continue') {
    return { allowed: true, reason: 'decision_continue', short_number: null, print_note: 'no_input_vat' };
  }
  if (row.status === 'refused' || row.status === 'decided') return blocked('waiting_for_choice');
  return blocked('waiting_for_number');
}
