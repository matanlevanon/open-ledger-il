-- R11 fix (this range, 1100-1199): protect a granted ITA allocation number with its own
-- append-only, hash-verified record, independent of the mutable documents.allocation_number and
-- ita_allocations.confirmation_number columns.
--
-- allocation_number is deliberately left out of the document's own hash (src/core/hashchain.ts,
-- HASHED_DOCUMENT_FIELDS): the ITA grants it after finalize, once the document's hash is already
-- fixed. That means nothing in the hash chain itself proves which number was later granted for
-- which frozen document, or catches a live column (documents.allocation_number,
-- ita_allocations.confirmation_number) edited directly. This table closes that gap: one append-
-- only row per grant, its own hash over (document_id, document_hash, allocation_number), so a
-- later check can prove both that the row itself was not tampered with, and that it still matches
-- the document's real hash and current allocation_number.

CREATE TABLE allocation_records (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents (id),
  -- documents.hash at the moment the number was granted. Frozen at finalize, so this always
  -- equals the document's hash from then on; carried here so the row proves the link on its own,
  -- without trusting whatever documents.hash happens to read at verification time.
  document_hash TEXT NOT NULL,
  allocation_number TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX allocation_records_document ON allocation_records (document_id);

CREATE TRIGGER allocation_records_no_update BEFORE UPDATE ON allocation_records
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

CREATE TRIGGER allocation_records_no_delete BEFORE DELETE ON allocation_records
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;
