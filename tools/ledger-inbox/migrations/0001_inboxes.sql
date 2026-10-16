-- ledger-inbox: one row per Ledger install with an email inbox (README.md).
-- inbox_id is the local part of the address: 10 characters of lowercase Crockford base32.
-- secret signs what the gateway sends to the Ledger. The Ledger holds the same value as INBOX_SECRET.
-- account_id and tax_id are what the licence is bound to, sent with each licence check.
-- Apply once: npx wrangler d1 migrations apply DB --remote
CREATE TABLE inboxes (
  id INTEGER PRIMARY KEY,
  inbox_id TEXT NOT NULL UNIQUE,
  ledger_origin TEXT NOT NULL,
  secret TEXT NOT NULL,
  licence_id INTEGER NOT NULL UNIQUE,
  account_id TEXT,
  tax_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  paused_at TEXT
);
