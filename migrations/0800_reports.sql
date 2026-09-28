-- R08: ceiling guard alerts and the monthly accountant pack. Owned by R08.
-- Money columns end in _minor. Not legal documents (CLAUDE.md rule 1 covers `documents`),
-- so no hash chain or freeze triggers here.

-- One row per ceiling alert actually sent, so a threshold fires at most once per calendar year
-- (docs/legal-requirements.md, "Ceiling guard": alerts at 70, 85, 95 and projected 100 percent).
CREATE TABLE ceiling_alerts (
  id INTEGER PRIMARY KEY,
  year INTEGER NOT NULL,
  threshold_pct INTEGER NOT NULL CHECK (threshold_pct IN (70, 85, 95, 100)),
  turnover_minor INTEGER NOT NULL,
  limit_minor INTEGER NOT NULL,
  fired_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (year, threshold_pct)
);

-- One row per monthly accountant pack run (docs/accountant-access.md "Monthly pack").
-- period is 'YYYY-MM', the calendar month the pack covers. Files live in the FILES R2 bucket
-- under accountant-packs/<period>/, same bucket as expense files, not BACKUPS (a different
-- purpose: a readable pack for a person, not a raw table export for a restore test).
CREATE TABLE accountant_packs (
  id INTEGER PRIMARY KEY,
  period TEXT NOT NULL UNIQUE,
  pdf_key TEXT NOT NULL,
  xlsx_key TEXT NOT NULL,
  zip_key TEXT NOT NULL,
  expense_file_count INTEGER NOT NULL DEFAULT 0,
  income_total_ils_minor INTEGER NOT NULL DEFAULT 0,
  expense_total_ils_minor INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  emailed_at TEXT,
  email_error TEXT
);
