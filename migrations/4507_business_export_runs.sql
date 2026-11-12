-- R48 task 4: export one business. Each run lists its files, and each file is built by its own
-- request and stored in R2 under exports/business/<id>/<run>/. `files` holds, per file name, the
-- R2 key, size and SHA-256 once built. "Mark as moved out" (task 5) needs a run with every file built.
CREATE TABLE business_export_runs (
  id TEXT PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses (id),
  plan TEXT NOT NULL CHECK (json_valid(plan)),
  files TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(files)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT,
  completed_at TEXT
);
CREATE INDEX business_export_runs_business ON business_export_runs (business_id, created_at);
