-- R47: unified file transmission to the Tax Authority (תוספת 1, 3.2026, required from 1.1.2027).
-- One row per send. The two file ids come from GetUrlsForUploadingFiles and are what
-- get-file-status takes. Status per file: uploaded, approved, rejected, or failed (our side).
CREATE TABLE unified_file_transmissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL DEFAULT 1 REFERENCES businesses(id),
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  case_number TEXT NOT NULL,
  unique_id TEXT,
  ini_file_id TEXT,
  bkm_file_id TEXT,
  ini_status TEXT,
  bkm_status TEXT,
  status_description TEXT,
  error TEXT,
  ini_bytes INTEGER,
  bkm_bytes INTEGER,
  test_upload INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  checked_at TEXT
);
CREATE INDEX unified_file_transmissions_business ON unified_file_transmissions (business_id, created_at);
