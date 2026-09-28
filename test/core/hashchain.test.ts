import { describe, expect, it } from 'vitest';
import { first, run } from '../../src/core/db';
import {
  GENESIS_HASH,
  allocationRecordHash,
  buildDocumentRecord,
  canonicalJson,
  computeHash,
  loadDocument,
  verifyChain,
} from '../../src/core/hashchain';
import { finalizeDocument } from '../../src/core/numbering';
import { D1AllocationDocuments } from '../../src/modules/ita/documents';
import { OWNER_ACTOR, db, makeDraft, makeSeries, sqlError } from '../helpers';

const IMMUTABLE_TRIGGER_SQL = async () =>
  (await first<{ sql: string }>(db(), `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?`, 'documents_immutable'))!.sql;

describe('canonical JSON', () => {
  it('sorts keys and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: { z: 1, y: 2 } })).toBe('{"a":[true,null,"x"],"b":1,"c":{"y":2,"z":1}}');
  });

  it('refuses floats so money never hashes as a float', () => {
    expect(() => canonicalJson({ amount: 1.5 })).toThrow(TypeError);
  });

  it('gives the same hash for the same content in any key order', async () => {
    const a = await computeHash({ x: 1, y: 'a' }, GENESIS_HASH);
    const b = await computeHash({ y: 'a', x: 1 }, GENESIS_HASH);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hash chain', () => {
  it('links each final document to the previous one', async () => {
    const s = await makeSeries();
    const first1 = await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR });
    const second = await finalizeDocument(db(), await makeDraft({ seriesId: s, payments: [{ amountMinor: 5000, currency: 'USD' }] }), {
      actor: OWNER_ACTOR,
    });
    expect(second.prevHash).toBe(first1.hash);
    const loaded = (await loadDocument(db(), second.documentId))!;
    expect(await computeHash(buildDocumentRecord(loaded.row, loaded.lines, loaded.payments), second.prevHash)).toBe(second.hash);
    const report = await verifyChain(db());
    expect(report.ok).toBe(true);
    expect(report.checked).toBeGreaterThanOrEqual(2);
  });

  it('stays valid after the whitelisted cancel', async () => {
    const s = await makeSeries();
    const res = await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR });
    await run(db(), `UPDATE documents SET status = 'cancelled', cancelled_at = 'now', cancel_reason = 'Duplicate' WHERE id = ?`, res.documentId);
    expect((await verifyChain(db())).ok).toBe(true);
  });

  /**
   * R11 (docs/israel-invoices-api.md §7): a qualifying tax invoice is hashed the moment it is
   * numbered, with allocation_number still NULL. The ITA grants the number afterwards.
   * allocation_number is excluded from HASHED_DOCUMENT_FIELDS for exactly this reason: the chain
   * must stay valid once the number arrives, the same as it does after the whitelisted cancel.
   */
  it('stays valid once the allocation number arrives after finalize', async () => {
    const s = await makeSeries();
    const res = await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR, status: 'awaiting_allocation' });
    const before = await verifyChain(db());
    expect(before.ok).toBe(true);
    await run(
      db(),
      `UPDATE documents SET status = 'final', allocation_number = '123456789012345678901234567', updated_at = 'now' WHERE id = ?`,
      res.documentId,
    );
    const after = await verifyChain(db());
    expect(after.ok).toBe(true);
    expect(after.headHash).toBe(res.hash);
  });

  it('detects tampering even when someone bypasses the triggers', async () => {
    const s = await makeSeries();
    const res = await finalizeDocument(db(), await makeDraft({ seriesId: s, lines: [{ description: 'Audit', unitPriceMinor: 250000 }] }), {
      actor: OWNER_ACTOR,
    });
    const triggerSql = await IMMUTABLE_TRIGGER_SQL();
    const lineTriggerSql = (await first<{ sql: string }>(
      db(),
      `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'document_lines_frozen_update'`,
    ))!.sql;
    try {
      // Simulate raw database tampering: drop the guards and edit a final document.
      await run(db(), 'DROP TRIGGER documents_immutable');
      await run(db(), 'DROP TRIGGER document_lines_frozen_update');
      await run(db(), 'UPDATE documents SET total_minor = 1 WHERE id = ?', res.documentId);
      await run(db(), 'UPDATE document_lines SET unit_price_minor = 1 WHERE document_id = ?', res.documentId);

      const report = await verifyChain(db());
      expect(report.ok).toBe(false);
      expect(report.breaks).toContainEqual({ seq: expect.any(Number), documentId: res.documentId, reason: 'content_changed' });

      // Rewriting the stored hash is caught too: it no longer matches finalizations.
      await run(db(), 'UPDATE documents SET hash = ? WHERE id = ?', 'f'.repeat(64), res.documentId);
      const again = await verifyChain(db());
      expect(again.breaks.map((b) => b.reason)).toContain('document_hash_mismatch');
    } finally {
      await run(db(), 'UPDATE documents SET total_minor = 250000, hash = ? WHERE id = ?', res.hash, res.documentId);
      await run(db(), 'UPDATE document_lines SET unit_price_minor = 250000 WHERE document_id = ?', res.documentId);
      await run(db(), triggerSql);
      await run(db(), lineTriggerSql);
    }
    expect((await verifyChain(db())).ok).toBe(true);
  });

  /**
   * R18 task 4: a document finalized from now on hashes hash_schema_version 2, which covers
   * detail_en/detail_he. finalizeDocument stamps the version itself; this proves the field is
   * really load-bearing in the stored hash, not just carried along inertly.
   */
  it('hashes a new document\'s line detail_en, at schema version 2', async () => {
    const s = await makeSeries();
    const draftId = await makeDraft({ seriesId: s, lines: [{ description: 'Audit', unitPriceMinor: 250000 }] });
    await run(db(), `UPDATE document_lines SET detail_en = 'Q3 review' WHERE document_id = ?`, draftId);
    const res = await finalizeDocument(db(), draftId, { actor: OWNER_ACTOR });

    const stamped = await first<{ hash_schema_version: number }>(db(), 'SELECT hash_schema_version FROM documents WHERE id = ?', res.documentId);
    expect(stamped?.hash_schema_version).toBe(2);
    expect((await verifyChain(db())).ok).toBe(true);

    const triggerSql = await IMMUTABLE_TRIGGER_SQL();
    const lineTriggerSql = (await first<{ sql: string }>(
      db(),
      `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'document_lines_frozen_update'`,
    ))!.sql;
    try {
      await run(db(), 'DROP TRIGGER documents_immutable');
      await run(db(), 'DROP TRIGGER document_lines_frozen_update');
      await run(db(), `UPDATE document_lines SET detail_en = 'tampered' WHERE document_id = ?`, res.documentId);

      const report = await verifyChain(db());
      expect(report.ok).toBe(false);
      expect(report.breaks).toContainEqual({ seq: expect.any(Number), documentId: res.documentId, reason: 'content_changed' });
    } finally {
      await run(db(), `UPDATE document_lines SET detail_en = 'Q3 review' WHERE document_id = ?`, res.documentId);
      await run(db(), triggerSql);
      await run(db(), lineTriggerSql);
    }
    expect((await verifyChain(db())).ok).toBe(true);
  });

  /**
   * R18 task 4: a document finalized before this migration hashed its lines under the original
   * field list alone. Its stored hash must keep verifying even though detail_en/detail_he now
   * exist as columns (NULL, backfilled by the migration) and even if one were later populated by
   * hand on that old, otherwise-frozen row: hash_schema_version 1 never looks at either column, so
   * buildDocumentRecord produces the exact same record it always did. A pure unit test, since
   * driving a real document down to schema version 1 through the live DB would itself change its
   * recomputed hash (hash_schema_version changes the line record's shape) and rightly break the
   * chain, which is exactly the tamper-evidence R18 task 4 relies on, covered by the test above.
   */
  it("never hashes detail_en/detail_he at schema version 1, so a pre-migration document's hash is untouched", () => {
    const baseDoc: Record<string, unknown> = {
      id: 1,
      type: '300',
      series_id: 'X',
      number: 1,
      legal_mode: 'patur',
      client_id: null,
      date: '2026-10-01',
      issuance_date: null,
      due_date: null,
      currency: 'ILS',
      fx_rate: null,
      fx_rate_date: null,
      fx_source: null,
      subtotal_minor: 100,
      vat_rate_bp: null,
      vat_amount_minor: 0,
      total_minor: 100,
      total_ils_minor: null,
      lang_variant: 'en',
      notes: null,
      finalized_at: '2026-10-01T00:00:00Z',
    };
    const line = (detailEn: string | null): Record<string, unknown> => ({
      position: 1,
      item_id: null,
      description_en: 'Legacy line',
      description_he: null,
      detail_en: detailEn,
      detail_he: null,
      quantity_milli: 1000,
      unit_price_minor: 100,
      discount_minor: 0,
      line_total_minor: 100,
    });

    const v1NoDetail = buildDocumentRecord({ ...baseDoc, hash_schema_version: 1 }, [line(null)], []);
    const v1WithDetailAddedByHand = buildDocumentRecord({ ...baseDoc, hash_schema_version: 1 }, [line('added after the fact')], []);
    expect(v1WithDetailAddedByHand).toEqual(v1NoDetail); // invisible at v1, whatever the value
    expect(v1NoDetail.lines[0]).not.toHaveProperty('detail_en');

    const v2WithDetail = buildDocumentRecord({ ...baseDoc, hash_schema_version: 2 }, [line('added after the fact')], []);
    expect(v2WithDetail).not.toEqual(v1WithDetailAddedByHand); // visible at v2: a different record, so a different hash
    expect(v2WithDetail.lines[0]).toMatchObject({ detail_en: 'added after the fact' });

    // A document with no hash_schema_version column at all (an export from before this migration)
    // defaults to version 1, the same as an explicit 1.
    const noColumnAtAll = { ...baseDoc };
    delete noColumnAtAll.hash_schema_version;
    expect(buildDocumentRecord(noColumnAtAll, [line('x')], [])).toEqual(v1NoDetail);
  });
});

/**
 * R11 fix 3: protect a granted allocation number with its own append-only, hash-verified record
 * (migrations/1101_allocation_integrity.sql), independent of the mutable
 * documents.allocation_number and ita_allocations.confirmation_number columns.
 */
describe('allocation_records', () => {
  it('D1AllocationDocuments.setStatus writes one row, hash-verified, with an audit entry', async () => {
    const s = await makeSeries();
    const res = await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR, status: 'awaiting_allocation' });
    const store = new D1AllocationDocuments(db());
    await store.setStatus(res.documentId, 'final', '987654321000000000123456789');

    const row = (await first<{ document_id: number; document_hash: string; allocation_number: string; hash: string }>(
      db(),
      'SELECT document_id, document_hash, allocation_number, hash FROM allocation_records WHERE document_id = ?',
      res.documentId,
    ))!;
    expect(row.document_hash).toBe(res.hash);
    expect(row.allocation_number).toBe('987654321000000000123456789');
    expect(row.hash).toBe(
      await allocationRecordHash({ documentId: res.documentId, documentHash: res.hash, allocationNumber: '987654321000000000123456789' }),
    );

    const audited = await first(db(), `SELECT id FROM audit_log WHERE action = 'ita.allocation.recorded' AND entity_id = ?`, String(res.documentId));
    expect(audited).not.toBeNull();

    const report = await verifyChain(db());
    expect(report.ok).toBe(true);
    expect(report.allocationsChecked).toBeGreaterThanOrEqual(1);
  });

  it('never writes a record when the status move itself fails', async () => {
    const s = await makeSeries();
    const res = await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR }); // already 'final', not awaiting a number
    const store = new D1AllocationDocuments(db());
    await expect(store.setStatus(res.documentId, 'final', '111111111000000000123456789')).rejects.toMatchObject({ code: 'not_awaiting_allocation' });
    const row = await first(db(), 'SELECT id FROM allocation_records WHERE document_id = ?', res.documentId);
    expect(row).toBeNull();
  });

  it('is append-only: update and delete are both refused', async () => {
    const s = await makeSeries();
    const res = await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR, status: 'awaiting_allocation' });
    const store = new D1AllocationDocuments(db());
    await store.setStatus(res.documentId, 'final', '222222222000000000123456789');

    expect(await sqlError(`UPDATE allocation_records SET allocation_number = 'x' WHERE document_id = ?`, res.documentId)).toMatch(/append_only/);
    expect(await sqlError('DELETE FROM allocation_records WHERE document_id = ?', res.documentId)).toMatch(/append_only/);
  });

  it('verifyChain catches a tampered allocation_records row, and a live column that drifted from it', async () => {
    const s = await makeSeries();
    const res = await finalizeDocument(db(), await makeDraft({ seriesId: s }), { actor: OWNER_ACTOR, status: 'awaiting_allocation' });
    const store = new D1AllocationDocuments(db());
    await store.setStatus(res.documentId, 'final', '333333333000000000123456789');

    const triggerSql = (await first<{ sql: string }>(
      db(),
      `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'allocation_records_no_update'`,
    ))!.sql;
    try {
      await run(db(), 'DROP TRIGGER allocation_records_no_update');
      await run(db(), `UPDATE allocation_records SET allocation_number = '000000000000000000000000000' WHERE document_id = ?`, res.documentId);
      const report = await verifyChain(db());
      expect(report.ok).toBe(false);
      expect(report.breaks.map((b) => b.reason)).toContain('allocation_hash_mismatch');
    } finally {
      await run(db(), `UPDATE allocation_records SET allocation_number = '333333333000000000123456789' WHERE document_id = ?`, res.documentId);
      await run(db(), triggerSql);
    }
    expect((await verifyChain(db())).ok).toBe(true);

    // A live column edited directly (documents.allocation_number), the record itself untouched:
    // caught as a mismatch between the two, not silently trusted.
    const documentsTriggerSql = await IMMUTABLE_TRIGGER_SQL();
    try {
      await run(db(), 'DROP TRIGGER documents_immutable');
      await run(db(), `UPDATE documents SET allocation_number = '999999999000000000000000000' WHERE id = ?`, res.documentId);
      const report = await verifyChain(db());
      expect(report.breaks.map((b) => b.reason)).toContain('allocation_number_mismatch');
    } finally {
      await run(db(), `UPDATE documents SET allocation_number = '333333333000000000123456789' WHERE id = ?`, res.documentId);
      await run(db(), documentsTriggerSql);
    }
    expect((await verifyChain(db())).ok).toBe(true);
  });
});
