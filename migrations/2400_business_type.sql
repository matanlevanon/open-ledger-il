-- R24 Phase A: the business type. עוסק פטור, עוסק מורשה or חברה בע"מ.
-- Read through src/modules/legal-mode/business-type.ts only, so Phase B can move it to businesses.

ALTER TABLE business_profile ADD COLUMN entity_type TEXT NOT NULL DEFAULT 'osek_patur'
  CHECK (entity_type IN ('osek_patur', 'osek_murshe', 'company'));

-- A Ledger that already switched is an עוסק מורשה. Every other column of business 1 stays as it is.
UPDATE business_profile SET entity_type = 'osek_murshe'
WHERE EXISTS (SELECT 1 FROM legal_modes WHERE mode = 'murshe');

-- VAT reporting frequency, a business setting. Bi-monthly unless the VAT office set monthly.
ALTER TABLE business_profile ADD COLUMN vat_reporting TEXT NOT NULL DEFAULT 'bimonthly'
  CHECK (vat_reporting IN ('monthly', 'bimonthly'));

-- The day of the month after the period on which the VAT report is due. Dated config (CLAUDE.md rule 4).
CREATE TABLE vat_report_due_days (
  id INTEGER PRIMARY KEY,
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 28),
  effective_from TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO vat_report_due_days (due_day, effective_from, note)
VALUES (15, '2020-01-01', 'Default, the 15th of the month after the period. Open question for the accountant, docs/open-questions.md');
