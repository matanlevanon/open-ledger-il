import { SYSTEM_ACTOR, type AuditActor, auditStatement } from '../../core/audit';
import { all, first, nowIso, run, stmt, todayIsrael, transaction } from '../../core/db';
import { ConflictError } from '../../core/errors';
import { allocationRecordHash } from '../../core/hashchain';
import { convert } from '../../core/money';
import { clientDisplayName } from '../clients/display';
import { NON_DEDUCTING_CUSTOMER_VAT } from './config';
import type { AllocationDocument } from './payload';

/**
 * The ITA flow reads and moves documents only through this port.
 *
 * The number is assigned before the ITA call (runs/R12-ita.md, note from R00b). The R00 triggers
 * accept a numbered document only as `final`. R11 adds the migration that lets the finalize
 * transaction write `awaiting_allocation`, `allocation_pending` and `allocation_refused` without
 * weakening immutability. Until then the D1 store works on the unnumbered path and tests use
 * `MemoryAllocationDocuments`.
 */

export const ALLOCATION_STATUSES = ['awaiting_allocation', 'allocation_pending', 'allocation_refused'] as const;
export type AllocationDocStatus = (typeof ALLOCATION_STATUSES)[number];

export interface AllocationDocumentStore {
  get(documentId: number): Promise<AllocationDocument | null>;
  /** Moves a document forward: between allocation statuses, or to final with the full allocation number. */
  setStatus(documentId: number, status: AllocationDocStatus | 'final', allocationNumber?: string | null): Promise<void>;
  /** Standard cancellation of a refused invoice (choice 1, and the original in a reverse charge). */
  cancel(documentId: number, reason: string, actor: AuditActor): Promise<void>;
  /**
   * Choice 3: a zero-VAT copy with its own number, same client and amounts, status awaiting_allocation.
   * The documents flow (R11) owns numbering, so it builds this copy.
   */
  createReverseChargeReplacement(documentId: number, actor: AuditActor): Promise<number>;
}

interface DocRow {
  id: number;
  type: string;
  number: number | null;
  status: string;
  date: string;
  issuance_date: string | null;
  finalized_at: string | null;
  created_at: string;
  currency: string;
  fx_rate: string | null;
  subtotal_minor: number;
  vat_rate_bp: number | null;
  vat_amount_minor: number;
  total_minor: number;
  total_ils_minor: number | null;
  client_vat_number: string | null;
  client_company_id: string | null;
  client_name_he: string | null;
  client_name_en: string | null;
}

interface LineRow {
  position: number;
  description_en: string;
  description_he: string | null;
  quantity_milli: number;
  unit_price_minor: number;
  discount_minor: number;
  line_total_minor: number;
}

/** A 9-digit Israeli VAT or company number, or the non-deducting code (FAQ 55). */
export function customerVatFor(vatNumber: string | null, companyId: string | null): string {
  for (const v of [vatNumber, companyId]) {
    const digits = (v ?? '').replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 9) return digits.padStart(9, '0');
  }
  return NON_DEDUCTING_CUSTOMER_VAT;
}

export class D1AllocationDocuments implements AllocationDocumentStore {
  constructor(private readonly db: D1Database) {}

  async get(documentId: number): Promise<AllocationDocument | null> {
    const d = await first<DocRow>(
      this.db,
      `SELECT d.id, d.type, d.number, d.status, d.date, d.issuance_date, d.finalized_at, d.created_at, d.currency,
              d.fx_rate, d.subtotal_minor, d.vat_rate_bp, d.vat_amount_minor, d.total_minor, d.total_ils_minor,
              c.vat_number AS client_vat_number, c.company_id AS client_company_id,
              c.name_he AS client_name_he, c.name_en AS client_name_en
       FROM documents d LEFT JOIN clients c ON c.id = d.client_id WHERE d.id = ?`,
      documentId,
    );
    if (!d) return null;
    const lines = await all<LineRow>(
      this.db,
      `SELECT position, description_en, description_he, quantity_milli, unit_price_minor, discount_minor, line_total_minor
       FROM document_lines WHERE document_id = ? ORDER BY position`,
      documentId,
    );
    const proforma = await first<{ id: number }>(
      this.db,
      `SELECT s.id FROM document_links l JOIN documents s ON s.id = l.source_id
       WHERE l.target_id = ? AND l.kind = 'converted' AND s.type = '332' LIMIT 1`,
      documentId,
    );
    // The ITA takes ILS. A foreign-currency tax invoice converts at its frozen rate.
    const ils = (minor: number) => (d.currency === 'ILS' || !d.fx_rate ? minor : convert(minor, d.fx_rate));
    const discount = lines.reduce((s, l) => s + l.discount_minor, 0);
    const payment = ils(d.subtotal_minor);
    const vat = ils(d.vat_amount_minor);
    const issued = d.issuance_date ?? todayIsrael(new Date(d.finalized_at ?? d.created_at));
    return {
      id: d.id,
      type: d.type,
      number: d.number,
      status: d.status,
      date: d.date,
      issuanceDate: issued,
      customerVatNumber: customerVatFor(d.client_vat_number, d.client_company_id),
      // R19 task 5: the ITA payload is Hebrew-facing, so Hebrew comes first; falls back to
      // English for an English-only client. null only when there is no client at all.
      customerName: clientDisplayName({ name_en: d.client_name_en, name_he: d.client_name_he }, 'he') || null,
      amountBeforeDiscountMinor: payment + ils(discount),
      discountMinor: ils(discount),
      paymentAmountMinor: payment,
      vatAmountMinor: vat,
      totalMinor: d.total_ils_minor ?? ils(d.total_minor),
      vatRateBp: d.vat_rate_bp,
      lines: lines.map((l) => ({
        position: l.position,
        description: l.description_he || l.description_en,
        quantityMilli: l.quantity_milli,
        unitPriceMinor: ils(l.unit_price_minor),
        discountMinor: ils(l.discount_minor),
        lineTotalMinor: ils(l.line_total_minor),
      })),
      proformaDocumentId: proforma?.id ?? null,
    };
  }

  async setStatus(documentId: number, status: AllocationDocStatus | 'final', allocationNumber?: string | null): Promise<void> {
    const result = await run(
      this.db,
      `UPDATE documents SET status = ?, allocation_number = COALESCE(?, allocation_number), updated_at = ?
       WHERE id = ? AND status IN ('awaiting_allocation', 'allocation_pending', 'allocation_refused')`,
      status,
      allocationNumber ?? null,
      nowIso(),
      documentId,
    );
    if (result.changes === 0) {
      throw new ConflictError('not_awaiting_allocation', 'This document is not waiting for an allocation number.');
    }
    // Only after the status move above is confirmed to have actually happened: an append-only,
    // hash-verified proof of the grant (migrations/1101_allocation_integrity.sql), independent of
    // documents.allocation_number and ita_allocations.confirmation_number, both of which stay
    // mutable columns. SYSTEM_ACTOR because this runs for every caller of setStatus alike
    // (Approval response, manual entry, reverse charge); the human actor behind the grant is
    // already on its own 'ita.allocation.*' audit row from src/modules/ita/service.ts.
    if (status === 'final' && allocationNumber) {
      const doc = await first<{ hash: string | null }>(this.db, 'SELECT hash FROM documents WHERE id = ?', documentId);
      if (doc?.hash) {
        const hash = await allocationRecordHash({ documentId, documentHash: doc.hash, allocationNumber });
        await transaction(this.db, [
          stmt(
            this.db,
            'INSERT INTO allocation_records (document_id, document_hash, allocation_number, hash) VALUES (?, ?, ?, ?)',
            documentId,
            doc.hash,
            allocationNumber,
            hash,
          ),
          auditStatement(this.db, SYSTEM_ACTOR, 'ita.allocation.recorded', 'document', documentId, { allocation_number: allocationNumber, hash }),
        ]);
      }
    }
  }

  async cancel(documentId: number, reason: string): Promise<void> {
    const at = nowIso();
    const result = await run(
      this.db,
      `UPDATE documents SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ?
       WHERE id = ? AND status IN ('allocation_refused', 'final')`,
      at,
      reason,
      at,
      documentId,
    );
    if (result.changes === 0) throw new ConflictError('not_cancellable', 'This document cannot be cancelled now.');
  }

  async createReverseChargeReplacement(): Promise<number> {
    throw new ConflictError(
      'reverse_charge_unavailable',
      'Reverse charge needs the tax invoice flow. It arrives with the עוסק מורשה mode run.',
    );
  }
}
