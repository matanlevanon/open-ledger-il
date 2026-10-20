-- R41: API keys for the public REST API under /v1. A key belongs to one business. Only its SHA-256 is
-- stored, with the last 4 characters to tell keys apart. The plain key is shown once.
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses (id),
  key_hash TEXT NOT NULL UNIQUE,
  last4 TEXT NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'read' CHECK (scope IN ('read', 'write')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT
);
CREATE INDEX api_keys_business ON api_keys (business_id, revoked_at);

-- Requests per key per minute, for the 120 a minute limit. The daily cron prunes old minutes.
CREATE TABLE api_rate (
  key_id INTEGER NOT NULL,
  minute TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, minute)
);

-- Idempotency-Key answers, kept 24 hours: the same key and body returns the first answer.
CREATE TABLE api_idempotency (
  key_id INTEGER NOT NULL,
  idem_key TEXT NOT NULL,
  business_id INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (key_id, idem_key)
);
