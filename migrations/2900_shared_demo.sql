-- R29: one shared, read-only sample set and private visitor drafts. These columns and tables stay
-- empty in a normal Ledger: only DEMO_MODE=1 writes them.
--
-- A visitor no longer gets a copy of the sample businesses. Every visitor opens the same master
-- businesses. A row a visitor creates carries the visitor's session key in demo_session_id. The
-- sample set has NULL there. In demo mode every read shows NULL rows plus the session's own rows.

ALTER TABLE documents ADD COLUMN demo_session_id TEXT;
ALTER TABLE clients ADD COLUMN demo_session_id TEXT;
ALTER TABLE contracts ADD COLUMN demo_session_id TEXT;
ALTER TABLE expenses ADD COLUMN demo_session_id TEXT;
ALTER TABLE expense_files ADD COLUMN demo_session_id TEXT;
ALTER TABLE suppliers ADD COLUMN demo_session_id TEXT;
ALTER TABLE demo_outbox ADD COLUMN demo_session_id TEXT;

-- Rule 1: a final document never changes, the new column included. The tag is set at insert and
-- never changes on any document, draft or final.
CREATE TRIGGER documents_demo_session_fixed BEFORE UPDATE ON documents
WHEN NEW.demo_session_id IS NOT OLD.demo_session_id
BEGIN
  SELECT RAISE(ABORT, 'immutable_document');
END;

CREATE INDEX documents_demo_session ON documents (demo_session_id) WHERE demo_session_id IS NOT NULL;
CREATE INDEX clients_demo_session ON clients (demo_session_id) WHERE demo_session_id IS NOT NULL;
CREATE INDEX contracts_demo_session ON contracts (demo_session_id) WHERE demo_session_id IS NOT NULL;
CREATE INDEX expenses_demo_session ON expenses (demo_session_id) WHERE demo_session_id IS NOT NULL;
CREATE INDEX expense_files_demo_session ON expense_files (demo_session_id) WHERE demo_session_id IS NOT NULL;
CREATE INDEX suppliers_demo_session ON suppliers (demo_session_id) WHERE demo_session_id IS NOT NULL;
CREATE INDEX demo_outbox_session ON demo_outbox (demo_session_id, id);

-- A session ends after 30 idle minutes. session_key tags the visitor's rows. It is random and is
-- not the cookie: the cookie's hash stays the primary key.
ALTER TABLE demo_sessions ADD COLUMN session_key TEXT;
ALTER TABLE demo_sessions ADD COLUMN lead_id INTEGER;
ALTER TABLE demo_sessions ADD COLUMN last_seen_at TEXT;
CREATE UNIQUE INDEX demo_sessions_key ON demo_sessions (session_key) WHERE session_key IS NOT NULL;
CREATE INDEX demo_sessions_expiry ON demo_sessions (admin, expires_at);

-- Per-visitor copies are gone. Their sessions and leftover rows go with the next reset.
DROP INDEX IF EXISTS demo_sandboxes_day;
DROP TABLE IF EXISTS demo_sandboxes;

-- The masters build once at a time. One row while a build runs. A row past expires_at is stale
-- (the build died) and the next request takes it over.
CREATE TABLE demo_build_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  holder TEXT NOT NULL,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- A fingerprint of each master business, taken when the build finishes and after each admin
-- write. The nightly reset rebuilds a master whose rows no longer match it.
ALTER TABLE demo_master_businesses ADD COLUMN fingerprint TEXT;

-- The sweep that deletes expired sessions and everything tagged with them. Read by the admin.
CREATE TABLE demo_sweeps (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER NOT NULL DEFAULT 0 CHECK (ok IN (0, 1)),
  sessions_removed INTEGER NOT NULL DEFAULT 0,
  rows_removed INTEGER NOT NULL DEFAULT 0,
  files_removed INTEGER NOT NULL DEFAULT 0,
  message TEXT
);

-- The reset's own counters, renamed in meaning: sandboxes_removed now counts visitor sessions.
ALTER TABLE demo_resets ADD COLUMN masters_rebuilt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE demo_resets ADD COLUMN businesses_removed INTEGER NOT NULL DEFAULT 0;
