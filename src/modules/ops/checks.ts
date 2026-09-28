import { all } from '../../core/db';
import { type ChainReport, verifyChain } from '../../core/hashchain';

/**
 * Nightly gap check (docs/legal-requirements.md, computerized-books appendix to instruction 36:
 * "one continuous number series per document type, no gaps, no deletion"). The finalize triggers
 * in migrations/0002_integrity.sql already refuse a gap or a reused number at write time, so this
 * is a defense-in-depth read: it never trusts that guarantee, it recomputes it from the raw rows.
 */

interface SeriesRow {
  id: string;
  doc_type: string;
  start_number: number;
}

export interface SeriesGapReport {
  seriesId: string;
  docType: string;
  ok: boolean;
  count: number;
  /** Numbers between start_number and the highest seen that never got a finalization, or that repeat. */
  problems: number[];
}

/** Pure: the numbers a finalized series should hold, start_number..max seen, against what is there. */
export function findGaps(numbers: readonly number[], startNumber: number): number[] {
  const problems: number[] = [];
  const seen = new Set<number>();
  let expected = startNumber;
  for (const n of [...numbers].sort((a, b) => a - b)) {
    if (seen.has(n)) {
      problems.push(n);
      continue;
    }
    seen.add(n);
    while (expected < n) {
      problems.push(expected);
      expected++;
    }
    expected = n + 1;
  }
  return problems;
}

/** Confirms every started series' finalized numbers run start_number..next_number-1 with no gaps or repeats. */
export async function checkSeriesGaps(db: D1Database): Promise<SeriesGapReport[]> {
  const series = await all<SeriesRow>(db, 'SELECT id, doc_type, start_number FROM series WHERE started_at IS NOT NULL');
  const out: SeriesGapReport[] = [];
  for (const s of series) {
    const rows = await all<{ number: number }>(db, 'SELECT number FROM finalizations WHERE series_id = ?', s.id);
    const numbers = rows.map((r) => r.number);
    const problems = findGaps(numbers, s.start_number);
    out.push({ seriesId: s.id, docType: s.doc_type, ok: problems.length === 0, count: numbers.length, problems });
  }
  return out;
}

export interface GapCheckResult {
  ok: boolean;
  series: SeriesGapReport[];
  chain: ChainReport;
}

export async function runGapCheck(db: D1Database): Promise<GapCheckResult> {
  const [series, chain] = await Promise.all([checkSeriesGaps(db), verifyChain(db)]);
  return { ok: series.every((s) => s.ok) && chain.ok, series, chain };
}
