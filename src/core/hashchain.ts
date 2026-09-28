import { all, first } from './db';

/**
 * Hash chain over final documents.
 *
 * hash = SHA-256( canonicalJson({ prev_hash, record }) ), hex encoded.
 * `record` is the frozen content of the document (fields in HASHED_DOCUMENT_FIELDS, its lines
 * and its payments). `prev_hash` is the hash of the document finalized just before, or
 * GENESIS_HASH for the first one. The chain is global and follows `finalizations.seq`.
 */

export const GENESIS_HASH = '0'.repeat(64);

/**
 * Document columns covered by the hash. A run that adds a frozen column to documents adds it here.
 * Status, cancellation, pdf_hashes and allocation_number stay out: they are the whitelisted
 * post-final (or, for allocation_number, post-numbering) changes. A qualifying tax invoice is
 * hashed the moment it is numbered, in status awaiting_allocation with allocation_number still
 * NULL (docs/israel-invoices-api.md §7); the ITA grants the number afterwards, without touching
 * the frozen content the hash actually certifies. Were allocation_number hashed, every one of
 * those documents would fail verifyChain the moment its number arrived.
 */
export const HASHED_DOCUMENT_FIELDS = [
  'id',
  'type',
  'series_id',
  'number',
  'legal_mode',
  'client_id',
  'date',
  'issuance_date',
  'due_date',
  'currency',
  'fx_rate',
  'fx_rate_date',
  'fx_source',
  'subtotal_minor',
  'vat_rate_bp',
  'vat_amount_minor',
  'total_minor',
  'total_ils_minor',
  'lang_variant',
  'notes',
  'finalized_at',
] as const;

export const HASHED_LINE_FIELDS = [
  'position',
  'item_id',
  'description_en',
  'description_he',
  'quantity_milli',
  'unit_price_minor',
  'discount_minor',
  'line_total_minor',
] as const;

/**
 * R18 task 4's optional line description (detail_en/detail_he), hashed only for a document
 * finalized under schema version 2 or later (documents.hash_schema_version). A document finalized
 * before this migration hashed its lines under HASHED_LINE_FIELDS alone; including these two
 * columns for it too would change its canonical JSON and break its already-stored hash, even
 * though their value is only ever NULL for a line that old. hash_schema_version itself is never
 * part of the hashed record (see buildDocumentRecord): it only selects which line field list
 * applies, so adding the column could not retroactively change any existing hash either.
 */
export const HASHED_LINE_FIELDS_V2 = [...HASHED_LINE_FIELDS, 'detail_en', 'detail_he'] as const;

/** The schema version finalizeDocument stamps on every document finalized from R18 task 4 on. */
export const CURRENT_HASH_SCHEMA_VERSION = 2;

export const HASHED_PAYMENT_FIELDS = [
  'method',
  'paid_on',
  'reference',
  'amount_minor',
  'currency',
  'fx_rate',
  'fx_rate_date',
  'fx_source',
  'amount_ils_minor',
] as const;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Canonical JSON: object keys sorted by code point, no whitespace, undefined dropped.
 * Numbers must be safe integers (money is always integer minor units), so their text form is stable.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value)) throw new TypeError(`Canonical JSON allows safe integers only, got ${value}`);
      return String(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`Canonical JSON cannot encode ${typeof value}`);
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function computeHash(record: unknown, prevHash: string): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(prevHash)) throw new RangeError('prev_hash must be 64 hex characters');
  return sha256Hex(canonicalJson({ prev_hash: prevHash, record }));
}

/**
 * The hash for one allocation_records row (migrations/1101_allocation_integrity.sql): proof that
 * this exact allocation number was granted for this exact frozen document, independent of the
 * document's own hash (which never covers allocation_number, see the comment above).
 */
export async function allocationRecordHash(input: { documentId: number; documentHash: string; allocationNumber: string }): Promise<string> {
  return sha256Hex(
    canonicalJson({ document_id: input.documentId, document_hash: input.documentHash, allocation_number: input.allocationNumber }),
  );
}

function pick<K extends string>(row: Record<string, unknown>, fields: readonly K[]): Record<K, Json> {
  const out = {} as Record<K, Json>;
  for (const f of fields) out[f] = (row[f] ?? null) as Json;
  return out;
}

export interface DocumentRecord {
  document: Record<string, Json>;
  lines: Record<string, Json>[];
  payments: Record<string, Json>[];
}

/** Builds the hashed record from raw rows. Lines sort by position, payments by id. */
export function buildDocumentRecord(
  doc: Record<string, unknown>,
  lines: Record<string, unknown>[],
  payments: Record<string, unknown>[],
): DocumentRecord {
  const schemaVersion = Number(doc.hash_schema_version ?? 1);
  const lineFields = schemaVersion >= 2 ? HASHED_LINE_FIELDS_V2 : HASHED_LINE_FIELDS;
  return {
    document: pick(doc, HASHED_DOCUMENT_FIELDS),
    lines: [...lines]
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map((l) => pick(l, lineFields)),
    payments: [...payments]
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((p) => pick(p, HASHED_PAYMENT_FIELDS)),
  };
}

export interface LoadedDocument {
  row: Record<string, unknown>;
  lines: Record<string, unknown>[];
  payments: Record<string, unknown>[];
}

export async function loadDocument(db: D1Database, documentId: number): Promise<LoadedDocument | null> {
  const row = await first<Record<string, unknown>>(db, 'SELECT * FROM documents WHERE id = ?', documentId);
  if (!row) return null;
  const lines = await all<Record<string, unknown>>(db, 'SELECT * FROM document_lines WHERE document_id = ? ORDER BY position', documentId);
  const payments = await all<Record<string, unknown>>(db, 'SELECT * FROM payments WHERE document_id = ? ORDER BY id', documentId);
  return { row, lines, payments };
}

export interface ChainBreak {
  /** finalizations.seq for a document break; the allocation_records row id for an allocation break. */
  seq: number;
  documentId: number;
  reason:
    | 'content_changed'
    | 'prev_hash_mismatch'
    | 'document_hash_mismatch'
    | 'document_missing'
    /** allocation_records.hash no longer matches (document_id, document_hash, allocation_number): the row itself was tampered with. */
    | 'allocation_hash_mismatch'
    /** The document's current hash no longer matches what the allocation record says it was when the number was granted. */
    | 'allocation_document_hash_mismatch'
    /** documents.allocation_number no longer matches the number this record proves was granted. */
    | 'allocation_number_mismatch';
}

export interface ChainReport {
  ok: boolean;
  checked: number;
  /** Rows read from allocation_records. 0 on a source that predates or omits that table (for example a pre-R11 export). */
  allocationsChecked: number;
  headHash: string;
  breaks: ChainBreak[];
}

async function tableExists(db: D1Database, name: string): Promise<boolean> {
  const row = await first<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", name);
  return row !== null;
}

type FinalizationRow = { seq: number; document_id: number; prev_hash: string; hash: string };
type AllocationRecordRow = { id: number; document_id: number; document_hash: string; allocation_number: string; hash: string };

/**
 * Everything verifyChain needs to read, abstracted over where the rows live: a live D1 database
 * (the nightly gap check, `checks.ts`) or a plain in-memory export (the quarterly backup restore
 * test, `src/modules/ops/backup.ts`, which must never write to a database). Both implementations
 * feed the same recomputation in `verifyChainFrom`.
 */
interface ChainSource {
  finalizations(): Promise<FinalizationRow[]>;
  loadDocument(documentId: number): Promise<LoadedDocument | null>;
  /** null when the source has no allocation_records table at all (a pre-R11 export). */
  allocationRecords(): Promise<AllocationRecordRow[] | null>;
  documentById(documentId: number): Promise<{ hash: string | null; allocation_number: string | null } | null>;
}

/**
 * Checks every allocation_records row (migrations/1101_allocation_integrity.sql): its own hash,
 * and that it still agrees with the document it names.
 */
async function verifyAllocationRecordsFrom(source: ChainSource, breaks: ChainBreak[]): Promise<number> {
  const rows = await source.allocationRecords();
  if (rows === null) return 0;
  for (const r of rows) {
    const recomputed = await allocationRecordHash({ documentId: r.document_id, documentHash: r.document_hash, allocationNumber: r.allocation_number });
    if (recomputed !== r.hash) {
      breaks.push({ seq: r.id, documentId: r.document_id, reason: 'allocation_hash_mismatch' });
      continue;
    }
    const doc = await source.documentById(r.document_id);
    if (!doc || doc.hash !== r.document_hash) {
      breaks.push({ seq: r.id, documentId: r.document_id, reason: 'allocation_document_hash_mismatch' });
    }
    if (!doc || doc.allocation_number !== r.allocation_number) {
      breaks.push({ seq: r.id, documentId: r.document_id, reason: 'allocation_number_mismatch' });
    }
  }
  return rows.length;
}

/**
 * Recomputes every hash in finalize order and compares with the stored values.
 * Detects edited content, edited hashes and removed or reordered links, then checks every
 * allocation_records row against the document it names.
 */
async function verifyChainFrom(source: ChainSource): Promise<ChainReport> {
  const rows = await source.finalizations();
  const breaks: ChainBreak[] = [];
  let expectedPrev = GENESIS_HASH;
  for (const f of rows) {
    if (f.prev_hash !== expectedPrev) {
      breaks.push({ seq: f.seq, documentId: f.document_id, reason: 'prev_hash_mismatch' });
    }
    const loaded = await source.loadDocument(f.document_id);
    if (!loaded) {
      breaks.push({ seq: f.seq, documentId: f.document_id, reason: 'document_missing' });
    } else {
      if (loaded.row.hash !== f.hash || loaded.row.prev_hash !== f.prev_hash) {
        breaks.push({ seq: f.seq, documentId: f.document_id, reason: 'document_hash_mismatch' });
      }
      const recomputed = await computeHash(buildDocumentRecord(loaded.row, loaded.lines, loaded.payments), f.prev_hash);
      if (recomputed !== f.hash) {
        breaks.push({ seq: f.seq, documentId: f.document_id, reason: 'content_changed' });
      }
    }
    expectedPrev = f.hash;
  }
  const allocationsChecked = await verifyAllocationRecordsFrom(source, breaks);
  return { ok: breaks.length === 0, checked: rows.length, allocationsChecked, headHash: expectedPrev, breaks };
}

function d1Source(db: D1Database): ChainSource {
  return {
    finalizations: () => all<FinalizationRow>(db, 'SELECT seq, document_id, prev_hash, hash FROM finalizations ORDER BY seq'),
    loadDocument: (documentId) => loadDocument(db, documentId),
    allocationRecords: async () => {
      if (!(await tableExists(db, 'allocation_records'))) return null;
      return all<AllocationRecordRow>(db, 'SELECT id, document_id, document_hash, allocation_number, hash FROM allocation_records ORDER BY id');
    },
    documentById: (documentId) => first(db, 'SELECT hash, allocation_number FROM documents WHERE id = ?', documentId),
  };
}

/** Live D1 read path: the nightly gap check (`src/modules/ops/checks.ts`) runs this against `env.DB`. */
export async function verifyChain(db: D1Database): Promise<ChainReport> {
  return verifyChainFrom(d1Source(db));
}

/** Rows already held in memory, keyed by table name, the shape a D1 export and a backup restore both use. */
export type ChainTables = Record<string, Record<string, unknown>[]>;

function tablesSource(tables: ChainTables): ChainSource {
  const documents = tables.documents ?? [];
  const lines = tables.document_lines ?? [];
  const payments = tables.payments ?? [];
  const documentsById = new Map<number, Record<string, unknown>>(documents.map((d) => [Number(d.id), d]));

  return {
    finalizations: async () =>
      [...(tables.finalizations ?? [])]
        .map((f) => ({ seq: Number(f.seq), document_id: Number(f.document_id), prev_hash: String(f.prev_hash), hash: String(f.hash) }))
        .sort((a, b) => a.seq - b.seq),
    loadDocument: async (documentId) => {
      const row = documentsById.get(documentId);
      if (!row) return null;
      return {
        row,
        lines: lines.filter((l) => Number(l.document_id) === documentId),
        payments: payments.filter((p) => Number(p.document_id) === documentId),
      };
    },
    allocationRecords: async () => {
      const rows = tables.allocation_records;
      if (rows === undefined) return null;
      return rows.map((r) => ({
        id: Number(r.id),
        document_id: Number(r.document_id),
        document_hash: String(r.document_hash),
        allocation_number: String(r.allocation_number),
        hash: String(r.hash),
      }));
    },
    documentById: async (documentId) => {
      const row = documentsById.get(documentId);
      if (!row) return null;
      return { hash: (row.hash as string | null) ?? null, allocation_number: (row.allocation_number as string | null) ?? null };
    },
  };
}

/**
 * The in-memory twin of `verifyChain`: same recomputation and the same checks, but over rows a
 * caller already holds (a backup export read back from R2) instead of live D1 queries. Used by
 * the quarterly restore test (`src/modules/ops/backup.ts`), which proves an export is restorable
 * by recomputing it, never by writing it into a database.
 */
export async function verifyChainFromTables(tables: ChainTables): Promise<ChainReport> {
  return verifyChainFrom(tablesSource(tables));
}
