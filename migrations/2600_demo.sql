-- R26: demo mode for the public Sample Ledger. These tables stay empty in a normal Ledger.
-- Nothing here changes a real Ledger's behaviour: every route that writes them runs only with
-- DEMO_MODE=1.

-- The master sample businesses. Visitors never act on them. The nightly reset never deletes them.
CREATE TABLE demo_master_businesses (
  business_id INTEGER PRIMARY KEY REFERENCES businesses (id),
  sample_key TEXT NOT NULL UNIQUE,
  seed_version INTEGER NOT NULL,
  loaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One sandbox per lead per day: a synthetic owner and copies of the master businesses.
CREATE TABLE demo_sandboxes (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER,
  user_id INTEGER NOT NULL REFERENCES users (id),
  day TEXT NOT NULL,
  business_ids TEXT NOT NULL DEFAULT '[]',
  copy_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX demo_sandboxes_day ON demo_sandboxes (day, lead_id);

-- Session cookies. Only a hash of the cookie value is stored. admin = the sample set as admin.
CREATE TABLE demo_sessions (
  token_hash TEXT PRIMARY KEY,
  sandbox_id INTEGER,
  user_id INTEGER NOT NULL REFERENCES users (id),
  admin INTEGER NOT NULL DEFAULT 0 CHECK (admin IN (0, 1)),
  admin_email TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);

-- Leads from the gate. Never touched by the reset.
CREATE TABLE demo_leads (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  first_visit_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_visit_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  visits INTEGER NOT NULL DEFAULT 1,
  ip TEXT,
  user_agent TEXT,
  sandbox_id INTEGER,
  webhook_status TEXT NOT NULL DEFAULT 'pending' CHECK (webhook_status IN ('pending', 'saved', 'failed', 'off'))
);

-- The consent record. One row per answer at the gate. Only confirmed_at and unsubscribed_at are
-- ever set, once each. Never deleted, never touched by the reset.
CREATE TABLE demo_consents (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES demo_leads (id),
  consent INTEGER NOT NULL CHECK (consent IN (0, 1)),
  consent_text TEXT NOT NULL,
  text_version TEXT NOT NULL,
  ip TEXT,
  given_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  confirmed_at TEXT,
  unsubscribed_at TEXT
);
CREATE INDEX demo_consents_lead ON demo_consents (lead_id, id);

CREATE TRIGGER demo_consents_no_delete BEFORE DELETE ON demo_consents
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

CREATE TRIGGER demo_consents_fixed BEFORE UPDATE ON demo_consents
BEGIN
  SELECT RAISE(ABORT, 'append_only')
  WHERE NEW.id IS NOT OLD.id OR NEW.lead_id IS NOT OLD.lead_id OR NEW.consent IS NOT OLD.consent
     OR NEW.consent_text IS NOT OLD.consent_text OR NEW.text_version IS NOT OLD.text_version
     OR NEW.ip IS NOT OLD.ip OR NEW.given_at IS NOT OLD.given_at
     OR (OLD.confirmed_at IS NOT NULL AND NEW.confirmed_at IS NOT OLD.confirmed_at)
     OR (OLD.unsubscribed_at IS NOT NULL AND NEW.unsubscribed_at IS NOT OLD.unsubscribed_at);
END;

-- Lead and consent events forwarded to DEMO_LEAD_WEBHOOK_URL. The daily cron retries the failed ones.
CREATE TABLE demo_lead_events (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES demo_leads (id),
  event TEXT NOT NULL CHECK (event IN ('lead', 'consent', 'unsubscribe')),
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'off')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at TEXT
);
CREATE INDEX demo_lead_events_status ON demo_lead_events (status, id);

-- One-time codes that reopen the same sandbox from another browser the same day.
CREATE TABLE demo_codes (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES demo_leads (id),
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Daily counters for the caps. scope is 'global' or 'sandbox:<id>'.
CREATE TABLE demo_usage (
  day TEXT NOT NULL,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  alerted_at TEXT,
  PRIMARY KEY (day, scope, kind)
);

-- Emails the demo would have sent to a client: shown as a preview, never sent.
CREATE TABLE demo_outbox (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX demo_outbox_business ON demo_outbox (business_id, id);

-- The nightly reset result, read by the admin page.
CREATE TABLE demo_resets (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER NOT NULL DEFAULT 0 CHECK (ok IN (0, 1)),
  trigger_by TEXT NOT NULL DEFAULT 'cron',
  sandboxes_removed INTEGER NOT NULL DEFAULT 0,
  triggers_before INTEGER,
  triggers_after INTEGER,
  masters_unchanged INTEGER CHECK (masters_unchanged IN (0, 1)),
  message TEXT
);

-- The reset writes one row here inside its transaction. A failed check fails the CHECK, and the
-- whole transaction rolls back. The table stays empty.
CREATE TABLE demo_reset_guard (
  check_name TEXT NOT NULL,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
