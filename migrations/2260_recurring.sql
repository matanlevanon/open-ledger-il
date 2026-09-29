-- Recurring documents. A schedule copies a template document on each run date
-- (src/modules/recurring). Mode 'approve' stops at a draft for Approve or Skip, mode 'auto'
-- finalizes and, with send_email, emails the copy to the client.
CREATE TABLE recurring_schedules (
  id INTEGER PRIMARY KEY,
  name TEXT,
  template_document_id INTEGER NOT NULL REFERENCES documents (id),
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  -- Day of the month the schedule keeps, so 31 Jan runs on 28 Feb and again on 31 Mar.
  anchor_day INTEGER NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),
  next_run_date TEXT NOT NULL,
  end_date TEXT,
  mode TEXT NOT NULL DEFAULT 'approve' CHECK (mode IN ('approve', 'auto')),
  send_email INTEGER NOT NULL DEFAULT 1 CHECK (send_email IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_run_at TEXT,
  created_by INTEGER REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One row per schedule per run date, so a second run on the same date does nothing.
CREATE TABLE recurring_runs (
  id INTEGER PRIMARY KEY,
  schedule_id INTEGER NOT NULL REFERENCES recurring_schedules (id),
  run_date TEXT NOT NULL,
  document_id INTEGER REFERENCES documents (id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_approval', 'issued', 'sent', 'skipped', 'failed')),
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (schedule_id, run_date)
);
CREATE INDEX recurring_runs_status ON recurring_runs (status);
