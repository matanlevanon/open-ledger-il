-- R17 task 7: "Upload existing documents" under Import. A document issued in another system
-- (SUMIT, Wave, other) before Open Ledger IL existed. Filed uploads are immutable and never take a
-- number in Open Ledger IL's own series (CLAUDE.md rule 2 is about that series; these rows are a
-- separate, append-only record of income already recognized elsewhere).

-- Staging row for one uploaded file, between "uploaded" and "filed": holds the file reference and
-- the raw extraction (or nothing, for manual entry) while the owner reviews it on screen. Mutable
-- until filed; not itself a legal record, so no freeze triggers.
CREATE TABLE external_document_uploads (
  id INTEGER PRIMARY KEY,
  r2_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  extracted_json TEXT,
  extraction_error TEXT,
  filed_document_id INTEGER,
  uploaded_by INTEGER REFERENCES users (id),
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE external_documents (
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
  UNIQUE (source, original_number)
);
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
