-- Optional licence keys (README.md, "Licence keys"). An install registered with a licence key
-- keeps the licence id from the licence service, the key's last 4 for the admin page, and the
-- Cloudflare account id and business tax number the licence is bound to. All NULL for installs
-- registered with the admin secret, which keep working as before.
-- Apply once, in the database's Console tab or: npx wrangler d1 execute ita-auth-clients --remote --file migrations/0002_licences.sql
ALTER TABLE clients ADD COLUMN licence_id INTEGER;
ALTER TABLE clients ADD COLUMN licence_last4 TEXT;
ALTER TABLE clients ADD COLUMN account_id TEXT;
ALTER TABLE clients ADD COLUMN tax_id TEXT;
