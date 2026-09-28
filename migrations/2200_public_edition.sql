-- R22: public edition. Personal data lives in settings, never in code.
-- The business tax id (ת"ז or ח.פ) printed on documents, entered in Settings > Business.
-- The OWNER_TAX_ID secret stays as a fallback and as the ITA user id (CLAUDE.md rule 5).
ALTER TABLE business_profile ADD COLUMN tax_id TEXT;

-- The signature image uploaded in Settings > Signature, stored in R2. Null prints no image.
ALTER TABLE business_profile ADD COLUMN signature_r2_key TEXT;

-- Neutral name for the "issued by this business" skip count of the Drive expense import.
ALTER TABLE drive_import_runs RENAME COLUMN skipped_issued_by_mtn TO skipped_issued_by_self;
