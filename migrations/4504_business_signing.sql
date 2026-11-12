-- R48 task 3: a signing key per business. The key is made in the browser (WebCrypto, RSA 3072)
-- or uploaded, and stored encrypted with ITA_TOKEN_KEY, context `signing:<businessId>`.
-- src/modules/pdf/signing.ts resolves the identity: the business's active row first, then the
-- env secrets as before (single edition every business, firm edition business 1 only).
-- Left out of backups on purpose (src/modules/ops/backup.ts): a lost key is replaced by a new
-- one, and PDFs already signed stay valid.
CREATE TABLE business_signing_keys (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses (id),
  key_enc TEXT NOT NULL,
  cert_pem TEXT NOT NULL,
  subject TEXT NOT NULL,
  serial TEXT NOT NULL,
  not_before TEXT NOT NULL,
  not_after TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('generated', 'uploaded')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT,
  retired_at TEXT
);

-- One active key per business.
CREATE UNIQUE INDEX business_signing_keys_one_active ON business_signing_keys (business_id) WHERE status = 'active';

-- A key row never disappears.
CREATE TRIGGER business_signing_keys_no_delete BEFORE DELETE ON business_signing_keys
BEGIN
  SELECT RAISE(ABORT, 'signing_key_fixed');
END;

-- The only change: active to retired, with retired_at. Nothing else moves.
CREATE TRIGGER business_signing_keys_fixed BEFORE UPDATE ON business_signing_keys
WHEN NEW.id IS NOT OLD.id OR NEW.business_id IS NOT OLD.business_id OR NEW.key_enc IS NOT OLD.key_enc
  OR NEW.cert_pem IS NOT OLD.cert_pem OR NEW.subject IS NOT OLD.subject OR NEW.serial IS NOT OLD.serial
  OR NEW.not_before IS NOT OLD.not_before OR NEW.not_after IS NOT OLD.not_after OR NEW.source IS NOT OLD.source
  OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
  OR (NEW.status IS NOT OLD.status AND NOT (OLD.status = 'active' AND NEW.status = 'retired' AND NEW.retired_at IS NOT NULL))
  OR (NEW.retired_at IS NOT OLD.retired_at AND NEW.status != 'retired')
  OR (OLD.status = 'retired' AND NEW.retired_at IS NOT OLD.retired_at)
BEGIN
  SELECT RAISE(ABORT, 'signing_key_fixed');
END;
