import { beforeEach, describe, expect, it } from 'vitest';
import { all, first, run } from '../../src/core/db';
import { finalizeDocument } from '../../src/core/numbering';
import { OWNER_ACTOR, db, docRow, makeDraft, makeSeries, sqlError } from '../helpers';

/** Columns a final row may change, under the rules in migrations/0002_integrity.sql. */
const WHITELISTED = new Set(['status', 'cancelled_at', 'cancel_reason', 'pdf_hashes', 'updated_at']);

function probeValue(type: string, current: unknown): string | number {
  if (/INT/i.test(type)) return typeof current === 'number' ? current + 1 : 1;
  return typeof current === 'string' ? `${current}x` : 'x';
}

let seriesId: string;
let finalId: number;

beforeEach(async () => {
  seriesId = await makeSeries();
  finalId = await makeDraft({ seriesId, payments: [{ amountMinor: 100000 }] });
  await finalizeDocument(db(), finalId, { actor: OWNER_ACTOR });
});

describe('rule 1: a final document never changes', () => {
  it('refuses an update of every non-whitelisted column (walks PRAGMA table_info)', async () => {
    const columns = await all<{ name: string; type: string }>(db(), 'PRAGMA table_info(documents)');
    const row = (await docRow(finalId))!;
    const frozen = columns.filter((c) => !WHITELISTED.has(c.name));
    expect(frozen.length).toBeGreaterThan(20);
    for (const col of frozen) {
      const err = await sqlError(`UPDATE documents SET "${col.name}" = ? WHERE id = ?`, probeValue(col.type, row[col.name]), finalId);
      expect(err, `column ${col.name} must be frozen`).toMatch(/immutable_document|invalid_status_transition/);
    }
  });

  it('refuses updated_at alone', async () => {
    expect(await sqlError(`UPDATE documents SET updated_at = 'x' WHERE id = ?`, finalId)).toMatch(/immutable_document/);
  });

  it('refuses delete of a final document', async () => {
    expect(await sqlError('DELETE FROM documents WHERE id = ?', finalId)).toMatch(/immutable_document/);
  });

  it('refuses insert, update and delete of lines of a final document', async () => {
    expect(
      await sqlError(
        `INSERT INTO document_lines (document_id, position, description_en, unit_price_minor, line_total_minor) VALUES (?, 99, 'x', 1, 1)`,
        finalId,
      ),
    ).toMatch(/immutable_line/);
    expect(await sqlError('UPDATE document_lines SET unit_price_minor = 1 WHERE document_id = ?', finalId)).toMatch(/immutable_line/);
    expect(await sqlError('DELETE FROM document_lines WHERE document_id = ?', finalId)).toMatch(/immutable_line/);
  });

  it('refuses moving a draft line onto a final document', async () => {
    const draft = await makeDraft({ seriesId });
    expect(await sqlError('UPDATE document_lines SET document_id = ? WHERE document_id = ?', finalId, draft)).toMatch(/immutable_line/);
  });

  it('refuses insert, update and delete of payments of a final document', async () => {
    expect(
      await sqlError(`INSERT INTO payments (document_id, method, paid_on, amount_minor, currency) VALUES (?, 'card', '2026-10-02', 1, 'ILS')`, finalId),
    ).toMatch(/immutable_payment/);
    expect(await sqlError('UPDATE payments SET amount_minor = 1 WHERE document_id = ?', finalId)).toMatch(/immutable_payment/);
    expect(await sqlError('DELETE FROM payments WHERE document_id = ?', finalId)).toMatch(/immutable_payment/);
  });

  it('refuses a document born final or numbered', async () => {
    expect(
      await sqlError(`INSERT INTO documents (type, series_id, date, status) VALUES (?, ?, '2026-10-01', 'final')`, seriesId, seriesId),
    ).toMatch(/final_requires_finalization/);
    expect(
      await sqlError(`INSERT INTO documents (type, series_id, date, number) VALUES (?, ?, '2026-10-01', 7)`, seriesId, seriesId),
    ).toMatch(/final_requires_finalization/);
  });

  it('refuses setting a draft to final outside the finalize transaction', async () => {
    const draft = await makeDraft({ seriesId });
    expect(await sqlError(`UPDATE documents SET status = 'final' WHERE id = ?`, draft)).toMatch(/final_requires_finalization/);
    expect(await sqlError(`UPDATE documents SET number = 42 WHERE id = ?`, draft)).toMatch(/final_requires_finalization/);
  });

  it('allows drafts to change and to be deleted', async () => {
    const draft = await makeDraft({ seriesId });
    await run(db(), 'UPDATE documents SET notes = ? WHERE id = ?', 'edited', draft);
    await run(db(), 'DELETE FROM document_lines WHERE document_id = ?', draft);
    await run(db(), 'DELETE FROM documents WHERE id = ?', draft);
    expect(await docRow(draft)).toBeNull();
  });
});

describe('rule 1: fixes go through cancel only, with a whitelisted status transition', () => {
  it('allows final to cancelled with a reason and a timestamp', async () => {
    await run(
      db(),
      `UPDATE documents SET status = 'cancelled', cancelled_at = '2026-10-02T10:00:00Z', cancel_reason = 'Sent to the wrong client', updated_at = 'now' WHERE id = ?`,
      finalId,
    );
    expect((await docRow(finalId))?.status).toBe('cancelled');
  });

  it('refuses cancel without a reason', async () => {
    expect(await sqlError(`UPDATE documents SET status = 'cancelled', cancelled_at = 'now' WHERE id = ?`, finalId)).toMatch(
      /invalid_status_transition/,
    );
    expect(
      await sqlError(`UPDATE documents SET status = 'cancelled', cancelled_at = 'now', cancel_reason = '  ' WHERE id = ?`, finalId),
    ).toMatch(/invalid_status_transition/);
  });

  it('refuses going back to draft, and leaving cancelled', async () => {
    expect(await sqlError(`UPDATE documents SET status = 'draft' WHERE id = ?`, finalId)).toMatch(/invalid_status_transition/);
    await run(db(), `UPDATE documents SET status = 'cancelled', cancelled_at = 'now', cancel_reason = 'Duplicate' WHERE id = ?`, finalId);
    expect(await sqlError(`UPDATE documents SET status = 'final' WHERE id = ?`, finalId)).toMatch(/invalid_status_transition/);
    expect(await sqlError(`UPDATE documents SET cancel_reason = 'Other' WHERE id = ?`, finalId)).toMatch(/immutable_document/);
    expect(await sqlError('DELETE FROM documents WHERE id = ?', finalId)).toMatch(/immutable_document/);
  });

  it('refuses cancelling a draft (drafts are deleted, not cancelled)', async () => {
    const draft = await makeDraft({ seriesId });
    expect(
      await sqlError(`UPDATE documents SET status = 'cancelled', cancelled_at = 'now', cancel_reason = 'x' WHERE id = ?`, draft),
    ).toMatch(/invalid_status_transition/);
  });
});

describe('rule 1: pdf_hashes is append-only', () => {
  it('allows first set and append, refuses rewrite and removal', async () => {
    await run(db(), `UPDATE documents SET pdf_hashes = ? WHERE id = ?`, '[{"variant":"filed","sha256":"aa"}]', finalId);
    await run(
      db(),
      `UPDATE documents SET pdf_hashes = ? WHERE id = ?`,
      '[{"variant":"filed","sha256":"aa"},{"variant":"client","sha256":"bb"}]',
      finalId,
    );
    expect(await sqlError(`UPDATE documents SET pdf_hashes = ? WHERE id = ?`, '[{"variant":"filed","sha256":"zz"},{"variant":"client","sha256":"bb"},{"x":1}]', finalId)).toMatch(/immutable_document/);
    expect(await sqlError(`UPDATE documents SET pdf_hashes = NULL WHERE id = ?`, finalId)).toMatch(/immutable_document/);
    expect(await sqlError(`UPDATE documents SET pdf_hashes = ? WHERE id = ?`, 'not json', finalId)).toMatch(/immutable_document/);
  });
});

describe('links and logs', () => {
  it('allows adding a link to a final document, refuses changing or removing it', async () => {
    const draft = await makeDraft({ seriesId });
    await run(db(), `INSERT INTO document_links (source_id, target_id, kind) VALUES (?, ?, 'converted')`, finalId, draft);
    expect(await sqlError(`UPDATE document_links SET kind = 'credit' WHERE source_id = ?`, finalId)).toMatch(/immutable_link/);
    expect(await sqlError('DELETE FROM document_links WHERE source_id = ?', finalId)).toMatch(/immutable_link/);
  });

  it('keeps audit_log and finalizations append-only', async () => {
    expect(await sqlError('UPDATE audit_log SET action = ?', 'x')).toMatch(/append_only/);
    expect(await sqlError('DELETE FROM audit_log')).toMatch(/append_only/);
    expect(await sqlError('UPDATE finalizations SET number = 99 WHERE document_id = ?', finalId)).toMatch(/append_only/);
    expect(await sqlError('DELETE FROM finalizations WHERE document_id = ?', finalId)).toMatch(/append_only/);
  });

  it('logs the finalize in audit_log', async () => {
    const row = await first<{ action: string; details: string }>(
      db(),
      `SELECT action, details FROM audit_log WHERE entity = 'document' AND entity_id = ?`,
      String(finalId),
    );
    expect(row?.action).toBe('document.finalize');
  });
});

/**
 * R11 (runs/R11-murshe.md, "Note from R00b"): a qualifying tax invoice is numbered by finalize
 * but leaves 'draft' as 'awaiting_allocation', not 'final'. migrations/1100_murshe.sql extends
 * the frozen-row triggers to that status and to 'allocation_pending' and 'allocation_refused',
 * without weakening the rules above for a 'final' row.
 */
describe('rule 1 for R11: a numbered document waiting for its allocation number is frozen too', () => {
  let allocId: number;

  beforeEach(async () => {
    allocId = await makeDraft({ seriesId, payments: [{ amountMinor: 50000 }] });
    await finalizeDocument(db(), allocId, { actor: OWNER_ACTOR, status: 'awaiting_allocation' });
  });

  it('is numbered and hashed like a final document, just not final', async () => {
    const row = await docRow(allocId);
    expect(row?.status).toBe('awaiting_allocation');
    expect(row?.number).not.toBeNull();
    expect(row?.hash).not.toBeNull();
  });

  it('refuses an update of every column final freezes, except allocation_number', async () => {
    const columns = await all<{ name: string; type: string }>(db(), 'PRAGMA table_info(documents)');
    const row = (await docRow(allocId))!;
    const frozen = columns.filter((c) => !WHITELISTED.has(c.name) && c.name !== 'allocation_number');
    for (const col of frozen) {
      const err = await sqlError(`UPDATE documents SET "${col.name}" = ? WHERE id = ?`, probeValue(col.type, row[col.name]), allocId);
      expect(err, `column ${col.name} must be frozen`).toMatch(/immutable_document|invalid_status_transition/);
    }
  });

  it('refuses insert, update and delete of lines, payments and links', async () => {
    expect(await sqlError('UPDATE document_lines SET unit_price_minor = 1 WHERE document_id = ?', allocId)).toMatch(/immutable_line/);
    expect(await sqlError('UPDATE payments SET amount_minor = 1 WHERE document_id = ?', allocId)).toMatch(/immutable_payment/);
    const draft = await makeDraft({ seriesId });
    await run(db(), `INSERT INTO document_links (source_id, target_id, kind) VALUES (?, ?, 'converted')`, allocId, draft);
    expect(await sqlError(`DELETE FROM document_links WHERE source_id = ?`, allocId)).toMatch(/immutable_link/);
  });

  it('refuses delete', async () => {
    expect(await sqlError('DELETE FROM documents WHERE id = ?', allocId)).toMatch(/immutable_document/);
  });

  it('allows allocation_number to change together with the status, the ITA flow writing both at once', async () => {
    await run(
      db(),
      `UPDATE documents SET status = 'final', allocation_number = ?, updated_at = 'now' WHERE id = ?`,
      '123456789012345678901234567',
      allocId,
    );
    const row = await docRow(allocId);
    expect(row?.status).toBe('final');
    expect(row?.allocation_number).toBe('123456789012345678901234567');
  });

  it('walks the allocation flow forward: awaiting_allocation -> allocation_pending -> allocation_refused -> final', async () => {
    await run(db(), `UPDATE documents SET status = 'allocation_pending', updated_at = 'now' WHERE id = ?`, allocId);
    await run(db(), `UPDATE documents SET status = 'allocation_refused', updated_at = 'now' WHERE id = ?`, allocId);
    await run(db(), `UPDATE documents SET status = 'final', updated_at = 'now' WHERE id = ?`, allocId);
    expect((await docRow(allocId))?.status).toBe('final');
  });

  it('allows allocation_refused to cancel, with a reason, the same rule as final', async () => {
    await run(db(), `UPDATE documents SET status = 'allocation_refused', updated_at = 'now' WHERE id = ?`, allocId);
    expect(
      await sqlError(`UPDATE documents SET status = 'cancelled', cancelled_at = 'now' WHERE id = ?`, allocId),
    ).toMatch(/invalid_status_transition/);
    await run(
      db(),
      `UPDATE documents SET status = 'cancelled', cancelled_at = 'now', cancel_reason = 'The ITA refused the number' WHERE id = ?`,
      allocId,
    );
    expect((await docRow(allocId))?.status).toBe('cancelled');
  });

  it('never goes back to draft, and never skips ahead of its allowed path', async () => {
    expect(await sqlError(`UPDATE documents SET status = 'draft' WHERE id = ?`, allocId)).toMatch(/invalid_status_transition/);
    await run(db(), `UPDATE documents SET status = 'allocation_pending', updated_at = 'now' WHERE id = ?`, allocId);
    expect(await sqlError(`UPDATE documents SET status = 'awaiting_allocation' WHERE id = ?`, allocId)).toMatch(/invalid_status_transition/);
    expect(
      await sqlError(`UPDATE documents SET status = 'cancelled', cancelled_at = 'now', cancel_reason = 'x' WHERE id = ?`, allocId),
    ).toMatch(/invalid_status_transition/);
  });
});
