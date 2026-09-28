-- R10 import. Owned by R10. Wave and SUMIT history is read-only at the API level (no update or
-- delete route exists), but it is not a legal document series (CLAUDE.md rule 1 governs
-- `documents`, not this table), so it carries no hash chain and no DB-level immutability trigger.
-- A bad import can be corrected by hand (wrangler d1 execute) without a migration.

-- One row per upload the owner previews and, once mapped, commits. Kept for the audit trail
-- of what was imported, when, and with which field mapping (never a value, no secrets here).
CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('wave_customers', 'wave_invoices', 'sumit_unified')),
  filename TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'committed' CHECK (status IN ('committed')),
  mapping_json TEXT,
  summary_json TEXT,
  created_by INTEGER REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Historical documents from Wave and SUMIT, read-only, outside the numbered series
-- (docs/ui-direction.md "Migration from Wave", runs/R10-import.md). Never feeds numbering,
-- reports or the hash chain. `external_id` plus `source`/`source_kind` is the idempotency key:
-- re-importing the same file, or an overlapping export, never creates a second row.
CREATE TABLE history (
  id INTEGER PRIMARY KEY,
  import_batch_id INTEGER NOT NULL REFERENCES import_batches (id),
  source TEXT NOT NULL CHECK (source IN ('wave', 'sumit')),
  source_kind TEXT NOT NULL, -- 'wave_invoice', 'sumit_c100', 'sumit_d110', 'sumit_d120'
  external_id TEXT,
  client_id INTEGER REFERENCES clients (id),
  client_name TEXT,
  doc_type TEXT,
  doc_number TEXT,
  doc_date TEXT,
  currency TEXT,
  amount_minor INTEGER,
  status TEXT,
  raw_line TEXT,
  raw_json TEXT NOT NULL,
  decoded INTEGER NOT NULL DEFAULT 1 CHECK (decoded IN (0, 1)),
  decode_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX history_dedupe ON history (source, source_kind, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX history_client ON history (client_id, doc_date);
CREATE INDEX history_batch ON history (import_batch_id);
