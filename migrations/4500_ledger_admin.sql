-- R48 task 1: the Ledger admin. Ledger-wide actions (add a business, VAT rates, ceilings, FX,
-- backups, the gap check, Updates, the firm team, Ledger-wide MCP tokens) need an admin in the
-- firm edition. In the single edition any owner passes, as before.
-- Backfill: every user who owns business 1 becomes an admin. The bootstrap owner gets it too
-- (src/core/auth.ts). A Ledger always keeps one admin: the last one is never demoted.
ALTER TABLE users ADD COLUMN is_ledger_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_ledger_admin IN (0, 1));

UPDATE users SET is_ledger_admin = 1
 WHERE id IN (SELECT user_id FROM user_businesses WHERE business_id = 1 AND role = 'owner');

CREATE TRIGGER users_keep_one_admin BEFORE UPDATE OF is_ledger_admin ON users
WHEN OLD.is_ledger_admin = 1 AND NEW.is_ledger_admin = 0
  AND NOT EXISTS (SELECT 1 FROM users WHERE is_ledger_admin = 1 AND active = 1 AND id != OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'last_ledger_admin');
END;
