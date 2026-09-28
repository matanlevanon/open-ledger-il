import { describe, expect, it } from 'vitest';
import { first, run } from '../../../src/core/db';
import { finalizeDocument } from '../../../src/core/numbering';
import { checkSeriesGaps, findGaps, runGapCheck } from '../../../src/modules/ops';
import { OWNER_ACTOR, db, makeDraft, makeSeries } from '../../helpers';

describe('findGaps (pure)', () => {
  it('finds nothing wrong in a clean run from the start number', () => {
    expect(findGaps([1, 2, 3, 4], 1)).toEqual([]);
    expect(findGaps([5, 6, 7], 5)).toEqual([]);
  });

  it('reports every missing number between the start and the highest seen', () => {
    expect(findGaps([1, 4], 1)).toEqual([2, 3]);
    expect(findGaps([10, 12, 15], 10)).toEqual([11, 13, 14]);
  });

  it('reports a reused number', () => {
    expect(findGaps([1, 2, 2, 3], 1)).toEqual([2]);
  });

  it('does not care about input order', () => {
    expect(findGaps([3, 1, 4], 1)).toEqual([2]);
  });

  it('is fine with an empty series', () => {
    expect(findGaps([], 1)).toEqual([]);
  });
});

describe('checkSeriesGaps and runGapCheck (against real D1)', () => {
  it('reads a clean series as ok, with no false positives from other tests running concurrently', async () => {
    const s = await makeSeries();
    await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR });
    await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR });

    const reports = await checkSeriesGaps(db());
    const mine = reports.find((r) => r.seriesId === s)!;
    expect(mine.ok).toBe(true);
    expect(mine.count).toBe(2);
    expect(mine.problems).toEqual([]);
  });

  it('leaves an unstarted series (no finalizations yet) out of the report', async () => {
    const s = await makeSeries();
    const reports = await checkSeriesGaps(db());
    expect(reports.some((r) => r.seriesId === s)).toBe(false);
  });

  it('runGapCheck fails when the chain or a series is broken, even after the app triggers are bypassed', async () => {
    const s = await makeSeries();
    const first1 = await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR });
    // Several independent guards stand between here and a real gap: finalizations_check (the
    // number must be the series' next_number), series_guard (next_number can only step by exactly
    // one, driven by finalizations_advance_series) and documents_finalize_guard (draft -> final
    // needs a matching finalizations row). Simulating raw tampering means dropping all four, the
    // same way test/core/hashchain.test.ts drops documents_immutable to test tampering.
    const triggerSql = async (name: string) =>
      (await first<{ sql: string }>(db(), `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?`, name))!.sql;
    const dropped = await Promise.all(
      ['finalizations_check', 'finalizations_advance_series', 'series_guard', 'documents_finalize_guard'].map(
        async (name) => [name, await triggerSql(name)] as const,
      ),
    );
    const draftId = await makeDraft({ seriesId: s });
    const hash = 'a'.repeat(64);
    try {
      for (const [name] of dropped) await run(db(), `DROP TRIGGER ${name}`);
      // Skip a number: insert the finalization directly, two above the last one issued.
      await run(
        db(),
        `INSERT INTO finalizations (document_id, series_id, number, doc_version, prev_hash, hash, finalized_at)
         VALUES (?, ?, ?, 0, ?, ?, '2026-10-06T00:00:00.000Z')`,
        draftId,
        s,
        first1.number + 2,
        first1.hash,
        hash,
      );
      await run(
        db(),
        `UPDATE documents SET status = 'final', number = ?, hash = ?, prev_hash = ?, finalized_at = '2026-10-06T00:00:00.000Z' WHERE id = ?`,
        first1.number + 2,
        hash,
        first1.hash,
        draftId,
      );

      const result = await runGapCheck(db());
      expect(result.ok).toBe(false);
      const mine = result.series.find((r) => r.seriesId === s)!;
      expect(mine.ok).toBe(false);
      expect(mine.problems).toContain(first1.number + 1);
    } finally {
      for (const [, sql] of dropped) await run(db(), sql);
    }
  });
});
