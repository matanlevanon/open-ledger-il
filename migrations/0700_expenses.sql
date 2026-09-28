-- R07 expenses. Owned by R07. Money columns end in _minor. Not a legal document series
-- (CLAUDE.md rule 1 covers issued documents in `documents`), so no hash chain or freeze
-- triggers here. Retention and immutability of the source files themselves is R2 object
-- lock (docs/legal-requirements.md), not a D1 trigger.

CREATE TABLE expense_categories (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  tax_id TEXT,
  country TEXT NOT NULL DEFAULT 'IL',
  default_category_id INTEGER REFERENCES expense_categories (id),
  default_currency TEXT NOT NULL DEFAULT 'ILS',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX suppliers_name ON suppliers (name);
CREATE INDEX suppliers_tax_id ON suppliers (tax_id);

-- One row per file pulled from Drive or uploaded directly, before or after extraction.
-- drive_file_id is unique so a repeated Drive scan never re-ingests the same file.
-- sha256 backs the file-hash duplicate check independent of the extracted content.
CREATE TABLE expense_files (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('drive', 'upload')),
  drive_file_id TEXT,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  expense_id INTEGER REFERENCES expenses (id),
  ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX expense_files_drive_file ON expense_files (drive_file_id) WHERE drive_file_id IS NOT NULL;
CREATE INDEX expense_files_sha256 ON expense_files (sha256);

-- One expense per ingested file. Statuses: new (awaiting review), filed, not_expense,
-- duplicate, returned (status_reason required). input_vat_reclaimable and allocation_number
-- are present now, used by the buyer-side check once legal mode switches to מורשה (R11/R12).
CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  file_id INTEGER REFERENCES expense_files (id),
  supplier_id INTEGER REFERENCES suppliers (id),
  category_id INTEGER REFERENCES expense_categories (id),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'filed', 'not_expense', 'duplicate', 'returned')),
  status_reason TEXT,
  duplicate_of_id INTEGER REFERENCES expenses (id),
  document_number TEXT,
  document_date TEXT,
  document_type TEXT,
  currency TEXT NOT NULL DEFAULT 'ILS',
  amount_minor INTEGER NOT NULL DEFAULT 0,
  vat_amount_minor INTEGER NOT NULL DEFAULT 0,
  input_vat_reclaimable INTEGER NOT NULL DEFAULT 0 CHECK (input_vat_reclaimable IN (0, 1)),
  allocation_number TEXT,
  amount_ils_minor INTEGER,
  fx_rate TEXT,
  fx_rate_date TEXT,
  fx_source TEXT,
  extracted_json TEXT,
  notes TEXT,
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX expenses_status ON expenses (status, document_date);
CREATE INDEX expenses_supplier_number ON expenses (supplier_id, document_number);
CREATE INDEX expenses_category ON expenses (category_id);
