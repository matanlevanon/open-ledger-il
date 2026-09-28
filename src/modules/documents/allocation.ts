import type { AuditActor } from '../../core/audit';
import { thresholdOn } from '../../core/config';
import { type Currency, HOME_CURRENCY, convert } from '../../core/money';

/**
 * Whether a finalizing document needs an ITA allocation number
 * (docs/israel-invoices-api.md §1, all four conditions together):
 *   1. a tax-invoice type: 305, 320, or 332 in the advance-approval case (the app issues no 310 or 345)
 *   2. amount before VAT above the threshold (thresholds.allocation, effective-dated)
 *   3. VAT amount above zero (so a 0% export never qualifies)
 *   4. the client is an Israeli עוסק מורשה (has a VAT or company number and is not foreign-resident)
 *
 * Mirrors src/modules/documents/ceiling.ts: the documents module defines its own small interface
 * rather than importing R12's AllocationService, so the two modules stay decoupled. R11 wires the
 * real one (src/modules/ita's ItaAllocationService) in src/modules/index.ts.
 */

const ALLOCATION_ELIGIBLE_TYPES = new Set(['305', '320', '332']);

export interface AllocationCheckDoc {
  type: string;
  date: string;
  subtotalMinor: number;
  vatAmountMinor: number;
  currency: Currency;
  fxRate: string | null;
}

export interface AllocationCheckClient {
  foreignResident: boolean;
  vatNumber: string | null;
  companyId: string | null;
}

export async function needsAllocation(db: D1Database, doc: AllocationCheckDoc, client: AllocationCheckClient | null): Promise<boolean> {
  if (!ALLOCATION_ELIGIBLE_TYPES.has(doc.type)) return false;
  if (doc.vatAmountMinor <= 0) return false;
  if (!client || client.foreignResident || !(client.vatNumber || client.companyId)) return false;
  const threshold = await thresholdOn(db, 'allocation', doc.date);
  if (!threshold) return false;
  const beforeVatIls = doc.currency === HOME_CURRENCY || !doc.fxRate ? doc.subtotalMinor : convert(doc.subtotalMinor, doc.fxRate);
  return beforeVatIls > threshold.amount_minor;
}

/** What documents/service.ts needs from R12's AllocationService after finalize opens the request. */
export interface AllocationRequester {
  request(documentId: number, actor: AuditActor): Promise<{ status: string; message: string }>;
}

/** Default until src/modules/index.ts wires the real ItaAllocationService, same pattern as documents/ceiling.ts. */
export const passThroughAllocationRequester: AllocationRequester = {
  async request(documentId) {
    return { status: 'pending', message: `Document ${documentId} is waiting for its allocation number. The ITA module is not wired in.` };
  },
};
