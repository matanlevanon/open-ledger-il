import { type AuditActor, auditStatement } from './audit';
import { first, nowIso, stmt, transaction } from './db';
import { ConflictError, NotFoundError, NumberingError, dbErrorCode } from './errors';
import { CURRENT_HASH_SCHEMA_VERSION, GENESIS_HASH, buildDocumentRecord, computeHash, loadDocument } from './hashchain';

/**
 * Document numbering. CLAUDE.md rule 2: numbers come from one place, the finalize transaction.
 *
 * D1 has no interactive transactions, so finalize is optimistic:
 *   1. Read the draft, the series' next number and the chain head.
 *   2. Compute the hash in the Worker.
 *   3. Commit one batch: INSERT INTO finalizations, UPDATE documents, extra statements, audit.
 * Triggers on `finalizations` refuse the insert when the number is no longer the series' next
 * number, the chain head moved, or the draft changed. The whole batch then rolls back and
 * finalize retries from step 1. Two concurrent finalizes can never share a number or leave a gap.
 */

export interface SeriesRow {
  id: string;
  doc_type: string;
  name_en: string;
  name_he: string | null;
  legal_mode: string | null;
  start_number: number;
  next_number: number;
  started_at: string | null;
  closed_at: string | null;
}

export async function getSeries(db: D1Database, seriesId: string): Promise<SeriesRow> {
  const row = await first<SeriesRow>(db, 'SELECT * FROM series WHERE id = ?', seriesId);
  if (!row) throw new NotFoundError('Series', seriesId);
  return row;
}

/**
 * The number the next finalize in this series will take. Read-only: a number is only
 * consumed when `finalizeDocument` commits. Use inside finalize, never to print a number early.
 */
export async function nextNumber(db: D1Database, seriesId: string): Promise<number> {
  const series = await getSeries(db, seriesId);
  if (series.closed_at) throw new NumberingError('series_closed', 'This number series is closed.');
  return series.next_number;
}

/** Sets the first number of a series. Allowed once per series, before its first final document. */
export async function setStartNumber(db: D1Database, seriesId: string, start: number, actor: AuditActor): Promise<void> {
  if (!Number.isSafeInteger(start) || start < 1) {
    throw new NumberingError('invalid_start_number', 'The starting number must be a whole number of 1 or more.');
  }
  const series = await getSeries(db, seriesId);
  if (series.started_at) {
    throw new NumberingError('series_started', 'The starting number is fixed once the series is in use.');
  }
  const results = await transaction(db, [
    stmt(
      db,
      'UPDATE series SET start_number = ?, next_number = ? WHERE id = ? AND started_at IS NULL',
      start,
      start,
      seriesId,
    ),
    auditStatement(db, actor, 'series.set_start', 'series', seriesId, { from: series.start_number, to: start }),
  ]);
  if (results[0]?.meta.changes !== 1) {
    throw new NumberingError('series_started', 'The starting number is fixed once the series is in use.');
  }
}

/** Closes a series for good. Used by the legal-mode switch (R11). */
export async function closeSeries(db: D1Database, seriesId: string, actor: AuditActor, at = nowIso()): Promise<void> {
  const series = await getSeries(db, seriesId);
  if (series.closed_at) throw new NumberingError('series_closed', 'This number series is already closed.');
  const results = await transaction(db, [
    stmt(db, 'UPDATE series SET closed_at = ? WHERE id = ? AND closed_at IS NULL', at, seriesId),
    auditStatement(db, actor, 'series.close', 'series', seriesId, { at }),
  ]);
  if (results[0]?.meta.changes !== 1) {
    throw new NumberingError('series_closed', 'This number series is already closed.');
  }
}

export interface FinalizeContext {
  documentId: number;
  seriesId: string;
  number: number;
  hash: string;
  prevHash: string;
  finalizedAt: string;
}

export interface FinalizeOptions {
  actor: AuditActor;
  /** Statements committed in the same transaction, for example links or source status updates. */
  extraStatements?: (ctx: FinalizeContext) => D1PreparedStatement[];
  /** Attempts before giving up under contention. */
  maxAttempts?: number;
  /**
   * The status the document takes in the same UPDATE that assigns its number. Default 'final'.
   * R11 (docs/israel-invoices-api.md §7) passes 'awaiting_allocation' for a qualifying tax
   * invoice: the number is assigned before the ITA Approval call, so the document is numbered
   * but not yet final. `status` is excluded from the hash (src/core/hashchain.ts), so this later
   * moves on to 'final' without touching the frozen record or its hash.
   */
  status?: 'final' | 'awaiting_allocation';
}

export interface FinalizeResult {
  documentId: number;
  seriesId: string;
  number: number;
  hash: string;
  prevHash: string;
  finalizedAt: string;
}

const RETRYABLE = new Set(['number_conflict', 'chain_conflict', 'draft_changed']);

/** Assigns the next number, hashes the frozen record into the chain and marks the document final. */
export async function finalizeDocument(db: D1Database, documentId: number, options: FinalizeOptions): Promise<FinalizeResult> {
  const maxAttempts = options.maxAttempts ?? 12;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const loaded = await loadDocument(db, documentId);
    if (!loaded) throw new NotFoundError('Document', documentId);
    const doc = loaded.row;
    if (doc.status !== 'draft') {
      throw new ConflictError('not_draft', 'Only a draft can be finalized.');
    }
    const seriesId = String(doc.series_id);
    const number = await nextNumber(db, seriesId);
    const head = await first<{ hash: string }>(db, 'SELECT hash FROM finalizations ORDER BY seq DESC LIMIT 1');
    const prevHash = head?.hash ?? GENESIS_HASH;
    const finalizedAt = nowIso();
    const record = buildDocumentRecord(
      { ...doc, number, finalized_at: finalizedAt, hash_schema_version: CURRENT_HASH_SCHEMA_VERSION },
      loaded.lines,
      loaded.payments,
    );
    const hash = await computeHash(record, prevHash);
    const ctx: FinalizeContext = { documentId, seriesId, number, hash, prevHash, finalizedAt };
    const status = options.status ?? 'final';

    try {
      await transaction(db, [
        stmt(
          db,
          `INSERT INTO finalizations (document_id, series_id, number, doc_version, prev_hash, hash, finalized_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          documentId,
          seriesId,
          number,
          Number(doc.version),
          prevHash,
          hash,
          finalizedAt,
        ),
        stmt(
          db,
          `UPDATE documents
           SET status = ?, number = ?, hash = ?, prev_hash = ?, finalized_at = ?, updated_at = ?, hash_schema_version = ?
           WHERE id = ? AND status = 'draft'`,
          status,
          number,
          hash,
          prevHash,
          finalizedAt,
          finalizedAt,
          CURRENT_HASH_SCHEMA_VERSION,
          documentId,
        ),
        ...(options.extraStatements?.(ctx) ?? []),
        auditStatement(db, options.actor, 'document.finalize', 'document', documentId, {
          series: seriesId,
          number,
          hash,
        }),
      ]);
      return ctx;
    } catch (err) {
      const code = dbErrorCode(err) ?? (err instanceof NumberingError ? err.code : undefined);
      if (code && RETRYABLE.has(code)) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, Math.min(5 * attempt, 40) + Math.random() * 10));
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new NumberingError('number_conflict', 'Finalize could not get a number. Try again.');
}
