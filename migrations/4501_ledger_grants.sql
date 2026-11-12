-- R48 task 1: firm staff. A Ledger grant applies to every business, present and future.
-- businessGrants (src/core/auth.ts) unions it with user_businesses. A direct grant on a business
-- wins over the Ledger grant. Used in the firm edition only.
CREATE TABLE ledger_grants (
  user_id INTEGER PRIMARY KEY REFERENCES users (id),
  role TEXT NOT NULL CHECK (role IN ('assistant', 'accountant')),
  -- JSON object of accountant feature switches. Null for an assistant.
  features TEXT,
  granted_by INTEGER REFERENCES users (id),
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ends_at TEXT
);
