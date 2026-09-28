-- R12 ITA Israel Invoices client. Owned by R12 (range 1200-1299).
-- Tokens are encrypted with AES-GCM (key: ITA_TOKEN_KEY secret). No plain token, client secret
-- or ID number (ת"ז) is ever stored here (CLAUDE.md rule 5).

-- One row per ITA environment. The Worker reads only the row for ITA_ENV (CLAUDE.md rule 7).
CREATE TABLE ita_tokens (
  environment TEXT PRIMARY KEY CHECK (environment IN ('sandbox', 'production')),
  refresh_token_enc TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  access_token_enc TEXT,
  access_expires_at TEXT,
  -- Last interactive ITA login (user code plus one-time code). Re-login is due at relogin_due_at.
  login_at TEXT NOT NULL,
  relogin_due_at TEXT NOT NULL,
  last_refresh_at TEXT,
  -- Goes up on every rotation, so two refreshes racing on one refresh token are detected.
  rotation INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reconnect_required')),
  status_reason TEXT,
  reminder_sent_at TEXT,
  connected_by INTEGER REFERENCES users (id),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- OAuth2 state values for /api/ita/connect. Single use, short lived.
CREATE TABLE ita_oauth_states (
  state TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  redirect_uri TEXT NOT NULL,
  user_id INTEGER REFERENCES users (id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One row per document that needs an allocation number.
-- invoice_id is the ITA single-value id (A50), a random UUID, never reused for an unrelated document.
-- The spec reuses it on purpose in three cases: a reverse charge and a request after a hearing
-- (same row), and a tax invoice born from a 332 advance approval (action 4, own row).
CREATE TABLE ita_allocations (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL UNIQUE REFERENCES documents (id),
  invoice_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',    -- waiting for a call or a retry
    'stalled',    -- 24 hours of retries passed, use the ITA web app
    'failed',     -- the ITA rejected the data (431, 434, 435, 446 and other 4xx)
    'refused',    -- 460 or 461, waiting for one of the four choices
    'decided',    -- a choice was sent to the ITA (or 462: it already had one)
    'approved'    -- a number was granted or entered by hand
  )),
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at TEXT,
  last_attempt_at TEXT,
  next_attempt_at TEXT,
  deadline_at TEXT,
  alerted_at TEXT,
  last_http_status INTEGER,
  last_error_code TEXT,
  last_error_message TEXT,
  confirmation_number TEXT,
  short_number TEXT CHECK (short_number IS NULL OR (length(short_number) = 9 AND short_number NOT GLOB '*[^0-9]*')),
  source TEXT CHECK (source IN ('api', 'multi_api', 'manual_web_app', 'reverse_charge', 'after_hearing')),
  source_note TEXT,
  decision TEXT CHECK (decision IN ('cancel', 'continue', 'reverse_charge', 'further_objection')),
  decision_at TEXT,
  decision_by INTEGER REFERENCES users (id),
  replacement_document_id INTEGER REFERENCES documents (id),
  entered_by INTEGER REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ita_allocations_queue ON ita_allocations (status, next_attempt_at);
CREATE INDEX ita_allocations_invoice ON ita_allocations (invoice_id);
CREATE INDEX ita_allocations_replacement ON ita_allocations (replacement_document_id);

-- A granted number never changes or disappears.
CREATE TRIGGER ita_allocations_number_frozen BEFORE UPDATE ON ita_allocations
WHEN OLD.confirmation_number IS NOT NULL
  AND (NEW.confirmation_number IS NOT OLD.confirmation_number OR NEW.short_number IS NOT OLD.short_number
       OR NEW.status IS NOT 'approved')
BEGIN
  SELECT RAISE(ABORT, 'immutable_document');
END;

CREATE TRIGGER ita_allocations_no_delete BEFORE DELETE ON ita_allocations
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

-- Append-only log of every ITA call for an allocation. No request body: it carries the ID number.
CREATE TABLE ita_allocation_attempts (
  id INTEGER PRIMARY KEY,
  allocation_id INTEGER NOT NULL REFERENCES ita_allocations (id),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  endpoint TEXT NOT NULL,
  http_status INTEGER,
  outcome TEXT NOT NULL,
  error_code TEXT,
  message TEXT
);
CREATE INDEX ita_allocation_attempts_allocation ON ita_allocation_attempts (allocation_id, at);

CREATE TRIGGER ita_allocation_attempts_no_update BEFORE UPDATE ON ita_allocation_attempts
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

CREATE TRIGGER ita_allocation_attempts_no_delete BEFORE DELETE ON ita_allocation_attempts
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;
