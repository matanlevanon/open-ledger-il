-- R28: contracts signed outside the Ledger, automatic reminders and a per-client switch.
--
-- An external contract is a record only: the signed PDF, who signed and when. It is inserted as
-- signed and never changes. contracts.template_id stays NOT NULL, so an external contract points
-- at a hidden per-business template of origin 'external' with an empty body. That template never
-- shows in Contract templates and a Ledger contract can never use it.

ALTER TABLE contracts ADD COLUMN origin TEXT NOT NULL DEFAULT 'ledger' CHECK (origin IN ('ledger', 'external'));
ALTER TABLE contract_templates ADD COLUMN origin TEXT NOT NULL DEFAULT 'ledger' CHECK (origin IN ('ledger', 'external'));

-- Off: no automatic payment or signing reminder. Manual Remind still works.
ALTER TABLE clients ADD COLUMN auto_reminders INTEGER NOT NULL DEFAULT 1 CHECK (auto_reminders IN (0, 1));

-- R28 task 11: the payment methods a new document for this client starts with, a JSON array of
-- payment_methods.id set on the client form. NULL or empty keeps the earlier rule: the client's
-- last used methods (payment_method_ids), then the business default.
ALTER TABLE clients ADD COLUMN default_payment_method_ids TEXT;

-- One row per automatic reminder: an email sent or failed, a WhatsApp reminder due, or one shared.
-- Append only. The cron dedupes on (target_kind, target_id, rule).
CREATE TABLE reminder_log (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses (id),
  client_id INTEGER NOT NULL REFERENCES clients (id),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('document', 'contract')),
  target_id INTEGER NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp_due')),
  rule TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('sent', 'failed', 'due', 'shared')),
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX reminder_log_target ON reminder_log (target_kind, target_id, rule);
CREATE INDEX reminder_log_client ON reminder_log (business_id, client_id, created_at);

CREATE TRIGGER reminder_log_same_business BEFORE INSERT ON reminder_log
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM clients WHERE id = NEW.client_id AND business_id = NEW.business_id);
END;

CREATE TRIGGER reminder_log_no_update BEFORE UPDATE ON reminder_log
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

CREATE TRIGGER reminder_log_no_delete BEFORE DELETE ON reminder_log
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

-- A template's origin never changes.
CREATE TRIGGER contract_templates_origin_fixed BEFORE UPDATE ON contract_templates
BEGIN
  SELECT RAISE(ABORT, 'contract_fixed') WHERE NEW.origin IS NOT OLD.origin;
END;

-- Rebuilt from 2520. A Ledger contract starts as a draft on a Ledger template, as before. An
-- external contract starts signed, with its PDF and hash, on an external template, and never as
-- anything else.
DROP TRIGGER contracts_same_business;
CREATE TRIGGER contracts_same_business BEFORE INSERT ON contracts
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM clients WHERE id = NEW.client_id AND business_id = NEW.business_id)
     OR NOT EXISTS (SELECT 1 FROM contract_templates WHERE id = NEW.template_id AND business_id = NEW.business_id)
     OR (NEW.included_template_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM contract_templates WHERE id = NEW.included_template_id AND business_id = NEW.business_id));
  SELECT RAISE(ABORT, 'contract_fixed')
  WHERE NOT EXISTS (SELECT 1 FROM contract_templates WHERE id = NEW.template_id AND origin = NEW.origin);
  SELECT RAISE(ABORT, 'contract_fixed') WHERE NEW.origin = 'ledger' AND NEW.status <> 'draft';
  SELECT RAISE(ABORT, 'contract_fixed')
  WHERE NEW.origin = 'external' AND (
       NEW.status <> 'signed' OR NEW.signed_at IS NULL OR NEW.signed_pdf_r2_key IS NULL OR NEW.signed_pdf_sha256 IS NULL
    OR NEW.sent_at IS NOT NULL OR NEW.sent_pdf_r2_key IS NOT NULL OR NEW.expires_at IS NOT NULL
    OR NEW.included_template_id IS NOT NULL OR NEW.linked_document_id IS NOT NULL);
END;

-- Rebuilt from 2520 with origin fixed. Every rule is copied unchanged, with one addition: an
-- external contract, signed from insert, may be voided. Void sets status and void_at only, and the
-- row and its PDF stay on record. An external contract never links a pro forma.
DROP TRIGGER contracts_fixed;
CREATE TRIGGER contracts_fixed BEFORE UPDATE ON contracts
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch')
  WHERE NEW.business_id IS NOT OLD.business_id OR NEW.client_id IS NOT OLD.client_id OR NEW.kind IS NOT OLD.kind OR NEW.id IS NOT OLD.id;
  SELECT RAISE(ABORT, 'contract_fixed') WHERE NEW.origin IS NOT OLD.origin;
  SELECT RAISE(ABORT, 'business_mismatch')
  WHERE NEW.included_template_id IS NOT NULL AND NEW.included_template_id IS NOT OLD.included_template_id
    AND NOT EXISTS (SELECT 1 FROM contract_templates WHERE id = NEW.included_template_id AND business_id = NEW.business_id);
  SELECT RAISE(ABORT, 'contract_fixed')
  WHERE OLD.status <> 'draft' AND (
       NEW.template_id IS NOT OLD.template_id
    OR NEW.template_version IS NOT OLD.template_version
    OR NEW.included_template_id IS NOT OLD.included_template_id
    OR NEW.included_template_version IS NOT OLD.included_template_version
    OR NEW.field_values_json IS NOT OLD.field_values_json
    OR NEW.language IS NOT OLD.language
    OR NEW.title IS NOT OLD.title
    OR NEW.sent_at IS NOT OLD.sent_at
    OR NEW.sent_pdf_r2_key IS NOT OLD.sent_pdf_r2_key
    OR NEW.sent_pdf_sha256 IS NOT OLD.sent_pdf_sha256
    OR NEW.owner_signed_at IS NOT OLD.owner_signed_at
    OR NEW.signer_email IS NOT OLD.signer_email
    OR NEW.created_by IS NOT OLD.created_by
    OR NEW.created_at IS NOT OLD.created_at
    OR NEW.status = 'draft');
  SELECT RAISE(ABORT, 'contract_fixed')
  WHERE OLD.status = 'signed' AND (
       (NEW.status IS NOT OLD.status AND NOT (OLD.origin = 'external' AND NEW.status = 'void' AND NEW.void_at IS NOT NULL))
    OR NEW.signer_values_json IS NOT OLD.signer_values_json
    OR NEW.signer_name IS NOT OLD.signer_name
    OR NEW.signer_phone IS NOT OLD.signer_phone
    OR NEW.signed_at IS NOT OLD.signed_at
    OR NEW.signed_pdf_r2_key IS NOT OLD.signed_pdf_r2_key
    OR NEW.signed_pdf_sha256 IS NOT OLD.signed_pdf_sha256
    OR NEW.signed_content_sha256 IS NOT OLD.signed_content_sha256
    OR NEW.identity_method IS NOT OLD.identity_method
    OR NEW.viewed_at IS NOT OLD.viewed_at
    OR NEW.expires_at IS NOT OLD.expires_at
    OR (NEW.void_at IS NOT OLD.void_at AND NOT (OLD.origin = 'external' AND NEW.status = 'void'))
    OR NEW.declined_at IS NOT OLD.declined_at
    OR (OLD.linked_document_id IS NOT NULL AND NEW.linked_document_id IS NOT OLD.linked_document_id)
    OR (OLD.origin = 'external' AND NEW.linked_document_id IS NOT OLD.linked_document_id));
  SELECT RAISE(ABORT, 'contract_fixed')
  WHERE OLD.status IN ('void', 'declined') AND NEW.status IS NOT OLD.status AND NEW.status <> 'void';
  SELECT RAISE(ABORT, 'contract_fixed')
  WHERE OLD.status = 'void' AND (NEW.status IS NOT OLD.status OR NEW.void_at IS NOT OLD.void_at);
  SELECT RAISE(ABORT, 'contract_fixed')
  WHERE NEW.status = 'signed' AND OLD.status <> 'signed' AND (NEW.signed_at IS NULL OR NEW.signed_pdf_sha256 IS NULL OR OLD.status NOT IN ('sent', 'viewed'));
  SELECT RAISE(ABORT, 'contract_fixed')
  WHERE OLD.status <> 'signed' AND NEW.linked_document_id IS NOT NULL;
END;
