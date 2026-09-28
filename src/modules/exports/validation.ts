import { all, first } from '../../core/db';
import type { SeriesSummary } from './types';

const ALLOCATION_PENDING_STATUSES = ['awaiting_allocation', 'allocation_pending', 'allocation_refused'];

interface FinalizedRow {
  series_id: string;
  doc_type: string;
  number: number;
}

/**
 * First and last number issued per series, for documents dated inside [from, to].
 *
 * A number is assigned by the finalize transaction itself (CLAUDE.md rule 2), but since R11
 * (migrations/1100_murshe.sql) a qualifying מורשה tax invoice finalizes into `awaiting_allocation`
 * first, not straight to `final`, and can sit in `allocation_pending`/`allocation_refused` for a
 * while before the ITA flow resolves it to `final` or `cancelled`. The series/gap check below has
 * to count all five statuses, or a document only waiting on its allocation number would read as a
 * hole in the series. Content the file actually carries (unified-file/build.ts, pcn874/build.ts)
 * stays restricted to `final`: CLAUDE.md rule 3 keeps a qualifying tax invoice from leaving the
 * system before its allocation number or a recorded refusal decision, and this report is exactly
 * that kind of export.
 */
const NUMBERED_STATUSES = ['final', 'cancelled', 'awaiting_allocation', 'allocation_pending', 'allocation_refused'];

export async function seriesSummaryForPeriod(db: D1Database, from: string, to: string): Promise<SeriesSummary[]> {
  const placeholders = NUMBERED_STATUSES.map(() => '?').join(',');
  const rows = await all<FinalizedRow>(
    db,
    `SELECT d.series_id, d.type AS doc_type, d.number
     FROM documents d
     WHERE d.number IS NOT NULL AND d.status IN (${placeholders}) AND d.date BETWEEN ? AND ?
     ORDER BY d.series_id, d.number`,
    ...NUMBERED_STATUSES,
    from,
    to,
  );
  const bySeries = new Map<string, SeriesSummary>();
  for (const r of rows) {
    const existing = bySeries.get(r.series_id);
    if (!existing) {
      bySeries.set(r.series_id, { seriesId: r.series_id, docType: r.doc_type, count: 1, firstNumber: r.number, lastNumber: r.number });
    } else {
      existing.count += 1;
      existing.firstNumber = Math.min(existing.firstNumber, r.number);
      existing.lastNumber = Math.max(existing.lastNumber, r.number);
    }
  }
  return [...bySeries.values()].sort((a, b) => a.seriesId.localeCompare(b.seriesId));
}

/**
 * How many מורשה bookkeeping documents dated in [from, to] are numbered but still stuck in one
 * of the three allocation-pending statuses (R11, migrations/1100_murshe.sql). Neither export
 * counts these in its own record totals (CLAUDE.md rule 3), so a caller adds this to its
 * warnings rather than leaving a reviewer to wonder why a document they know about is missing.
 */
export async function pendingAllocationCount(db: D1Database, from: string, to: string): Promise<number> {
  const placeholders = ALLOCATION_PENDING_STATUSES.map(() => '?').join(',');
  const row = await first<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n
     FROM documents d
     JOIN document_types dt ON dt.code = d.type
     WHERE dt.modes = 'murshe' AND dt.bookkeeping = 1 AND d.status IN (${placeholders}) AND d.date BETWEEN ? AND ?`,
    ...ALLOCATION_PENDING_STATUSES,
    from,
    to,
  );
  return row?.n ?? 0;
}
