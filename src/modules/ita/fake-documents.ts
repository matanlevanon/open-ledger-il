import type { AuditActor } from '../../core/audit';
import { ConflictError, NotFoundError } from '../../core/errors';
import { ALLOCATION_STATUSES, type AllocationDocStatus, type AllocationDocumentStore } from './documents';
import type { AllocationDocument } from './payload';

/**
 * In-memory document store: the fake finalize path for the ITA flow until R11 lets the D1
 * triggers hold numbered documents in an allocation status. It keeps the same rules the R11
 * migration must keep: a numbered document only moves forward, to final or to cancelled.
 */
export class MemoryAllocationDocuments implements AllocationDocumentStore {
  readonly docs = new Map<number, AllocationDocument & { allocationNumber: string | null; cancelReason: string | null }>();
  private nextNumber = 9000;

  /** `newDocumentId` creates the row a reverse-charge copy lives in (tests insert a D1 draft). */
  constructor(private readonly newDocumentId: (originalId: number) => Promise<number> = async (id) => id + 100000) {}

  add(doc: AllocationDocument): void {
    this.docs.set(doc.id, { ...doc, allocationNumber: null, cancelReason: null });
  }

  async get(documentId: number): Promise<AllocationDocument | null> {
    const d = this.docs.get(documentId);
    return d ? { ...d, lines: [...d.lines] } : null;
  }

  async setStatus(documentId: number, status: AllocationDocStatus | 'final', allocationNumber?: string | null): Promise<void> {
    const d = this.docs.get(documentId);
    if (!d) throw new NotFoundError('Document', documentId);
    if (!(ALLOCATION_STATUSES as readonly string[]).includes(d.status)) {
      throw new ConflictError('not_awaiting_allocation', 'This document is not waiting for an allocation number.');
    }
    d.status = status;
    if (allocationNumber) d.allocationNumber = allocationNumber;
  }

  async cancel(documentId: number, reason: string, _actor: AuditActor): Promise<void> {
    const d = this.docs.get(documentId);
    if (!d) throw new NotFoundError('Document', documentId);
    if (d.status !== 'allocation_refused' && d.status !== 'final') {
      throw new ConflictError('not_cancellable', 'This document cannot be cancelled now.');
    }
    d.status = 'cancelled';
    d.cancelReason = reason;
  }

  async createReverseChargeReplacement(documentId: number, _actor: AuditActor): Promise<number> {
    const d = this.docs.get(documentId);
    if (!d) throw new NotFoundError('Document', documentId);
    const id = await this.newDocumentId(documentId);
    this.add({
      ...d,
      id,
      number: this.nextNumber++,
      status: 'awaiting_allocation',
      vatAmountMinor: 0,
      totalMinor: d.paymentAmountMinor,
      vatRateBp: 0,
    });
    return id;
  }
}
