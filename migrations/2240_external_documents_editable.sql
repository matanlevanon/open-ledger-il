-- Imported past documents become editable, their file does not. The fields read from the PDF
-- (type, number, date, client, amounts, paid status) can be corrected from the app, which audits
-- every change with its old and new values. What identifies the filed PDF stays frozen: source,
-- file key, hash, upload and who filed it. Delete stays blocked (migrations/1704).
DROP TRIGGER external_documents_no_update;

CREATE TRIGGER external_documents_file_frozen BEFORE UPDATE OF source, r2_key, sha256, upload_id, filed_by, filed_at ON external_documents
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

-- A receipt issued in this ledger against an imported pro forma or payment request. Once that
-- receipt is final, the imported document reads as paid. Deleting the draft receipt drops the link.
CREATE TABLE external_document_receipts (
  external_id INTEGER NOT NULL REFERENCES external_documents (id),
  document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (external_id, document_id)
);
CREATE INDEX external_document_receipts_document ON external_document_receipts (document_id);
