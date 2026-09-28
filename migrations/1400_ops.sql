-- R14 ops. Migration range 1400-1499.
-- Payment links join business_profile (R00), filled from the settings screen.
ALTER TABLE business_profile ADD COLUMN payment_link_stripe TEXT;
ALTER TABLE business_profile ADD COLUMN payment_link_paypal TEXT;

-- One row per backup run (quarterly cron or a manual trigger from the settings screen).
-- Never deleted (docs/legal-requirements.md: quarterly backup, no purge code).
CREATE TABLE backups (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('quarterly', 'manual')),
  ran_at TEXT NOT NULL,
  d1_export_key TEXT NOT NULL,
  manifest_key TEXT NOT NULL,
  table_count INTEGER NOT NULL,
  document_count INTEGER NOT NULL,
  chain_head_hash TEXT NOT NULL,
  restore_ok INTEGER NOT NULL CHECK (restore_ok IN (0, 1)),
  restore_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX backups_ran_at ON backups (ran_at DESC);
