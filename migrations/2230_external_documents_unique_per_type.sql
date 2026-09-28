-- An imported past document is a duplicate only when source, document type AND number all match.
-- SUMIT numbers each type separately, so quote 1000 and payment request 1000 are two documents.
-- SQLite cannot change a table constraint in place, so the table is rebuilt with the same columns,
-- indexes and append-only triggers as migrations/1704_external_documents.sql. No table references it.
CREATE TABLE external_documents_new (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('sumit', 'wave', 'other')),
  original_number TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  client_id INTEGER REFERENCES clients (id),
  -- The name as printed on the original document, kept even once matched to a client, so the
  -- filed record always shows exactly what the source document said.
  client_name_text TEXT NOT NULL,
  client_tax_id TEXT,
  currency TEXT NOT NULL,
  amount_before_vat_minor INTEGER NOT NULL,
  vat_amount_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL,
  -- Resolved at filing time from the same Bank of Israel history every other document uses
  -- (src/modules/fx), so it lines up with the ceiling meter and income reports. Null only when no
  -- rate could be resolved for a foreign-currency document (kept out of ILS totals until fixed).
  total_ils_minor INTEGER,
  fx_rate TEXT,
  fx_rate_date TEXT,
  paid_status TEXT NOT NULL CHECK (paid_status IN ('paid', 'unpaid', 'unknown')),
  r2_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  upload_id INTEGER REFERENCES external_document_uploads (id),
  filed_by INTEGER REFERENCES users (id),
  filed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source, doc_type, original_number)
);
INSERT INTO external_documents_new SELECT * FROM external_documents;
DROP TABLE external_documents;
ALTER TABLE external_documents_new RENAME TO external_documents;
CREATE INDEX external_documents_client ON external_documents (client_id);
CREATE INDEX external_documents_date ON external_documents (issue_date);

CREATE TRIGGER external_documents_no_update BEFORE UPDATE ON external_documents
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

CREATE TRIGGER external_documents_no_delete BEFORE DELETE ON external_documents
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;
