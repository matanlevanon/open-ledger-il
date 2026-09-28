-- R20: expenses from Google Drive. Owned by R20. Touches no document, number or hash.

-- Fixed (recurring) or one-off, from the index sheet's קבוע column. Null when unknown.
ALTER TABLE expenses ADD COLUMN is_fixed INTEGER CHECK (is_fixed IN (0, 1));

-- One row per month import, from the Import month button or the daily job.
-- details_json holds the per-row skips (with the matched expense id), status counts and errors.
CREATE TABLE drive_import_runs (
  id INTEGER PRIMARY KEY,
  year_month TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'daily')),
  source TEXT NOT NULL CHECK (source IN ('sheet', 'folder', 'none', 'failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  files_seen INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL DEFAULT 0,
  skipped_duplicate INTEGER NOT NULL DEFAULT 0,
  skipped_not_expense INTEGER NOT NULL DEFAULT 0,
  skipped_issued_by_mtn INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX drive_import_runs_recent ON drive_import_runs (id DESC);
