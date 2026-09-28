-- R13 exports: unified file (מבנה אחיד) and PCN874. Owned by R13 (range 1300-1399).
-- No hash chain or freeze triggers: an export is a derived report, not a legal document
-- series covered by CLAUDE.md rule 1.

-- Internal document type code to the ITA unified-file "document type" code (spec table, not
-- named here since the spec differs by record and the mapping is not yet confirmed). One row per
-- document_types row that the unified file can carry.
--
-- specs/unified-file/ holds only a README placeholder as of this migration (run R13): the ITA
-- record-layout PDF was never dropped in before the run. CLAUDE.md and runs/R13-exports.md both
-- say never guess a document code, so spec_code starts NULL for every row. Fill it in from the
-- real spec PDF's record-layout tables (never from memory or another country's format), one row
-- at a time; the exporter falls back to internal_code and flags the run until every code used in
-- the period is confirmed.
CREATE TABLE unified_file_doc_type_codes (
  internal_code TEXT PRIMARY KEY REFERENCES document_types (code),
  spec_code TEXT,
  note TEXT,
  confirmed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO unified_file_doc_type_codes (internal_code, note) VALUES
  ('QT', 'Quote: not a bookkeeping record (document_types.bookkeeping = 0). Likely excluded from the unified file; confirm against the spec''s scope section.'),
  ('PR', 'Payment request: not a bookkeeping record. Likely excluded; confirm against the spec.'),
  ('300', 'חשבון עסקה. Spec code unknown: specs/unified-file/ has no record-layout PDF yet.'),
  ('400', 'קבלה. Spec code unknown: specs/unified-file/ has no record-layout PDF yet.'),
  ('405', 'קבלת זיכוי. Spec code unknown: specs/unified-file/ has no record-layout PDF yet.'),
  ('305', 'חשבונית מס. Spec code unknown: specs/unified-file/ has no record-layout PDF yet.'),
  ('320', 'חשבונית מס/קבלה. Spec code unknown: specs/unified-file/ has no record-layout PDF yet.'),
  ('330', 'חשבונית זיכוי. Spec code unknown: specs/unified-file/ has no record-layout PDF yet.'),
  ('332', 'חשבון עסקה באישור מראש. Spec code unknown: specs/unified-file/ has no record-layout PDF yet.');

-- One row per export actually generated, so the validation report (record counts, totals,
-- first/last number per series) stays inspectable after the fact instead of only in the
-- one-off HTTP response. Not a legal document: no freeze triggers, just an append-only log.
CREATE TABLE export_runs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('unified_file', 'pcn874')),
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  total_ils_minor INTEGER NOT NULL DEFAULT 0,
  series_summary TEXT NOT NULL DEFAULT '[]',
  warnings TEXT NOT NULL DEFAULT '[]',
  layout_status TEXT NOT NULL DEFAULT 'stub' CHECK (layout_status IN ('stub', 'verified')),
  generated_by INTEGER REFERENCES users (id),
  generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX export_runs_kind ON export_runs (kind, generated_at);

CREATE TRIGGER export_runs_no_update BEFORE UPDATE ON export_runs
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

CREATE TRIGGER export_runs_no_delete BEFORE DELETE ON export_runs
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;
