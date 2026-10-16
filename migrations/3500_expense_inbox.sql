-- R35: receipts forwarded by email (docs/expense-inbox.md).
-- The address, the switch, the allowed senders and the Gmail confirmation live in `settings` under
-- expenses.inbox_*. The signing secret is the Worker secret INBOX_SECRET. This migration adds no
-- settings row: absent reads as the default.

-- Signatures seen in the last 10 minutes. A second request with the same one is a replay.
CREATE TABLE inbox_signatures (
  signature TEXT PRIMARY KEY,
  seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- What happened to each email, for Settings > Expenses > Email inbox. No content, only the sender,
-- the subject's first 200 characters, and the outcome.
CREATE TABLE inbox_events (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sender TEXT NOT NULL,
  subject TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('expense', 'duplicate', 'ignored', 'confirmation', 'empty', 'off')),
  expense_id INTEGER REFERENCES expenses (id),
  business_id INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX inbox_events_at ON inbox_events (business_id, at);
