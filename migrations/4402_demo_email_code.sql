-- R48: the demo gate asks every visitor for a 6-digit email code before the demo opens, when the
-- gate can send email. The code row keeps the gate's answers until the code is typed in.
ALTER TABLE demo_codes ADD COLUMN consent INTEGER CHECK (consent IN (0, 1));
ALTER TABLE demo_codes ADD COLUMN lang TEXT CHECK (lang IN ('en', 'he'));
-- When the visitor first typed a right code, and when the lead first got into the demo.
-- A lead is forwarded to the webhook on its first entry, so a fake email is never forwarded.
ALTER TABLE demo_leads ADD COLUMN email_verified_at TEXT;
ALTER TABLE demo_leads ADD COLUMN entered_at TEXT;
UPDATE demo_leads SET entered_at = first_visit_at;
CREATE INDEX demo_codes_lead_created ON demo_codes (lead_id, created_at);
