import { describe, expect, it } from 'vitest';
import { all, run, stmt } from '../../src/core/db';
import { NumberingError } from '../../src/core/errors';
import { closeSeries, finalizeDocument, getSeries, nextNumber, setStartNumber } from '../../src/core/numbering';
import { OWNER_ACTOR, db, docRow, makeDraft, makeSeries, sqlError } from '../helpers';

async function numbersIn(seriesId: string): Promise<number[]> {
  const rows = await all<{ number: number }>(db(), 'SELECT number FROM documents WHERE series_id = ? AND number IS NOT NULL ORDER BY number', seriesId);
  return rows.map((r) => r.number);
}

describe('rule 2: numbers have no gaps', () => {
  it('numbers each finalize strictly +1 from the start number', async () => {
    const s = await makeSeries();
    for (let i = 0; i < 5; i++) await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR });
    expect(await numbersIn(s)).toEqual([1, 2, 3, 4, 5]);
    expect(await nextNumber(db(), s)).toBe(6);
  });

  it('does not consume a number when the finalize transaction fails', async () => {
    const s = await makeSeries();
    const doc = await makeDraft({ seriesId: s });
    await expect(
      finalizeDocument(db(), doc, {
        actor: OWNER_ACTOR,
        extraStatements: () => [stmt(db(), 'INSERT INTO no_such_table VALUES (1)')],
      }),
    ).rejects.toThrow();
    expect((await docRow(doc))?.status).toBe('draft');
    expect(await nextNumber(db(), s)).toBe(1);
    await finalizeDocument(db(), doc, { actor: OWNER_ACTOR });
    expect(await numbersIn(s)).toEqual([1]);
  });

  it('refuses a manual jump of next_number', async () => {
    const s = await makeSeries();
    await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR });
    expect(await sqlError('UPDATE series SET next_number = 10 WHERE id = ?', s)).toMatch(/series_sequence/);
    expect(await sqlError('UPDATE series SET next_number = 3 WHERE id = ?', s)).toMatch(/series_sequence/);
    expect(await sqlError('UPDATE series SET next_number = 1 WHERE id = ?', s)).toMatch(/series_sequence/);
  });
});

describe('rule 2: numbers are never reused', () => {
  it('refuses finalizing the same document twice', async () => {
    const s = await makeSeries();
    const doc = await makeDraft({ seriesId: s });
    await finalizeDocument(db(), doc, { actor: OWNER_ACTOR });
    await expect(finalizeDocument(db(), doc, { actor: OWNER_ACTOR })).rejects.toMatchObject({ code: 'not_draft' });
    expect(await numbersIn(s)).toEqual([1]);
  });

  it('refuses a hand-written finalization with a used number', async () => {
    const s = await makeSeries();
    await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR });
    const other = await makeDraft({ seriesId: s });
    const err = await sqlError(
      `INSERT INTO finalizations (document_id, series_id, number, doc_version, prev_hash, hash) VALUES (?, ?, 1, 0, 'a', 'b')`,
      other,
      s,
    );
    expect(err).toMatch(/number_conflict|draft_changed/);
  });

  it('keeps one open series per document type', async () => {
    const s = await makeSeries();
    expect(
      await sqlError(`INSERT INTO series (id, doc_type, name_en) VALUES (?, ?, 'dup')`, `${s}-2`, s),
    ).toMatch(/UNIQUE/);
  });
});

describe('rule 2: concurrent finalize', () => {
  it('gives ten parallel finalizes ten distinct consecutive numbers', async () => {
    const s = await makeSeries(100);
    const docs = await Promise.all(Array.from({ length: 10 }, () => makeDraft({ seriesId: s })));
    const results = await Promise.all(docs.map((d) => finalizeDocument(db(), d, { actor: OWNER_ACTOR, maxAttempts: 40 })));
    expect(results.map((r) => r.number).sort((a, b) => a - b)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
    expect(await numbersIn(s)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
  });

  it('lets exactly one of two parallel finalizes of the same draft win', async () => {
    const s = await makeSeries();
    const doc = await makeDraft({ seriesId: s });
    const outcomes = await Promise.allSettled([
      finalizeDocument(db(), doc, { actor: OWNER_ACTOR }),
      finalizeDocument(db(), doc, { actor: OWNER_ACTOR }),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(await numbersIn(s)).toEqual([1]);
    expect(await nextNumber(db(), s)).toBe(2);
  });

  it('refuses a stale draft: the frozen record is the one that was hashed', async () => {
    const s = await makeSeries();
    const doc = await makeDraft({ seriesId: s });
    const version = (await docRow(doc))!.version as number;
    await run(db(), 'UPDATE document_lines SET unit_price_minor = 5 WHERE document_id = ?', doc);
    const err = await sqlError(
      `INSERT INTO finalizations (document_id, series_id, number, doc_version, prev_hash, hash) VALUES (?, ?, 1, ?, 'a', 'b')`,
      doc,
      s,
      version,
    );
    expect(err).toMatch(/draft_changed/);
  });
});

describe('rule 2: starting number is settable once', () => {
  it('sets the start before first use', async () => {
    const s = await makeSeries();
    await setStartNumber(db(), s, 79, OWNER_ACTOR);
    await setStartNumber(db(), s, 80, OWNER_ACTOR);
    const res = await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR });
    expect(res.number).toBe(80);
  });

  it('refuses a new start after the first final document', async () => {
    const s = await makeSeries();
    await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR });
    await expect(setStartNumber(db(), s, 500, OWNER_ACTOR)).rejects.toMatchObject({ code: 'series_started' });
    expect(await sqlError('UPDATE series SET start_number = 500, next_number = 500 WHERE id = ?', s)).toMatch(/series_started/);
  });

  it('refuses invalid start numbers', async () => {
    const s = await makeSeries();
    await expect(setStartNumber(db(), s, 0, OWNER_ACTOR)).rejects.toBeInstanceOf(NumberingError);
    await expect(setStartNumber(db(), s, 1.5, OWNER_ACTOR)).rejects.toBeInstanceOf(NumberingError);
  });
});

describe('closed series', () => {
  it('refuses finalize in a closed series and never reopens', async () => {
    const s = await makeSeries();
    const doc = await makeDraft({ seriesId: s });
    await closeSeries(db(), s, OWNER_ACTOR);
    await expect(finalizeDocument(db(), doc, { actor: OWNER_ACTOR })).rejects.toMatchObject({ code: 'series_closed' });
    expect(await sqlError('UPDATE series SET closed_at = NULL WHERE id = ?', s)).toMatch(/series_reopen/);
    expect((await getSeries(db(), s)).next_number).toBe(1);
  });

  it('refuses deleting a series in use', async () => {
    const s = await makeSeries();
    await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR });
    expect(await sqlError('DELETE FROM series WHERE id = ?', s)).toMatch(/series_started/);
  });
});
