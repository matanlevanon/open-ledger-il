-- ita-auth client registry. One row per Ledger install allowed to use the broker.
-- Apply once: npx wrangler d1 execute ita-auth-clients --remote --file migrations/0001_clients.sql
CREATE TABLE IF NOT EXISTS clients (
  name TEXT PRIMARY KEY,
  origin TEXT NOT NULL UNIQUE,
  business TEXT,
  key_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT
);

-- Every change to a client, kept for the record. Never deleted by the broker.
CREATE TABLE IF NOT EXISTS client_events (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  client TEXT NOT NULL,
  action TEXT NOT NULL,
  by TEXT
);
