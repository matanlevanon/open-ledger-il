-- R25: contracts and work orders, Fill & Sign. Per business. Templates are versioned, a sent
-- contract keeps the version it was sent with. A signed contract never changes. Its PDFs live in
-- R2 under business/<business_id>/contracts/<sha256>.pdf, write-once. Events are append only.

-- Services for the Work Order scope picker. Editing this list never changes a sent contract: the
-- contract stores the names and items it was sent with in field_values_json.
CREATE TABLE contract_services (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses (id),
  name_en TEXT NOT NULL DEFAULT '',
  name_he TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'fixed_fee' CHECK (model IN ('fixed_fee', 'monthly_retainer', 'milestones')),
  model_label_en TEXT,
  model_label_he TEXT,
  description_en TEXT NOT NULL DEFAULT '',
  description_he TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX contract_services_business ON contract_services (business_id, active, sort_order);

CREATE TABLE contract_service_items (
  id INTEGER PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES contract_services (id),
  business_id INTEGER NOT NULL REFERENCES businesses (id),
  label_en TEXT NOT NULL DEFAULT '',
  label_he TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
CREATE INDEX contract_service_items_service ON contract_service_items (service_id, active, sort_order);

CREATE TRIGGER contract_services_business_fixed BEFORE UPDATE ON contract_services
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch') WHERE NEW.business_id IS NOT OLD.business_id;
END;

CREATE TRIGGER contract_service_items_same_business BEFORE INSERT ON contract_service_items
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM contract_services WHERE id = NEW.service_id AND business_id = NEW.business_id);
END;

CREATE TRIGGER contract_service_items_fixed BEFORE UPDATE ON contract_service_items
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch') WHERE NEW.business_id IS NOT OLD.business_id OR NEW.service_id IS NOT OLD.service_id;
END;

-- A template and its versions. The template row holds the current version number. A version used
-- by a sent contract never changes: an edit then writes the next version.
CREATE TABLE contract_templates (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses (id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('contract', 'work_order')),
  current_version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX contract_templates_business ON contract_templates (business_id, active);

CREATE TABLE contract_template_versions (
  id INTEGER PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES contract_templates (id),
  business_id INTEGER NOT NULL REFERENCES businesses (id),
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('contract', 'work_order')),
  body_en TEXT NOT NULL DEFAULT '',
  body_he TEXT NOT NULL DEFAULT '',
  -- The field list as JSON: key, labels, kind, required, party, source, options.
  fields_json TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (template_id, version)
);

CREATE TRIGGER contract_templates_no_delete BEFORE DELETE ON contract_templates
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

CREATE TRIGGER contract_templates_business_fixed BEFORE UPDATE ON contract_templates
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch') WHERE NEW.business_id IS NOT OLD.business_id OR NEW.kind IS NOT OLD.kind;
  SELECT RAISE(ABORT, 'contract_fixed') WHERE NEW.current_version < OLD.current_version;
END;

CREATE TRIGGER contract_template_versions_same_business BEFORE INSERT ON contract_template_versions
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM contract_templates WHERE id = NEW.template_id AND business_id = NEW.business_id AND kind = NEW.kind);
END;

CREATE TRIGGER contract_template_versions_no_delete BEFORE DELETE ON contract_template_versions
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

-- A version that a sent (not draft) contract uses never changes.
CREATE TRIGGER contract_template_versions_fixed BEFORE UPDATE ON contract_template_versions
BEGIN
  SELECT RAISE(ABORT, 'contract_fixed')
  WHERE NEW.id IS NOT OLD.id OR NEW.template_id IS NOT OLD.template_id OR NEW.business_id IS NOT OLD.business_id
     OR NEW.version IS NOT OLD.version OR NEW.kind IS NOT OLD.kind
     OR EXISTS (SELECT 1 FROM contracts WHERE template_id = OLD.template_id AND template_version = OLD.version AND status <> 'draft');
END;

CREATE TABLE contracts (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses (id),
  client_id INTEGER NOT NULL REFERENCES clients (id),
  template_id INTEGER NOT NULL REFERENCES contract_templates (id),
  template_version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('contract', 'work_order')),
  title TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'he', 'both')),
  -- Every filled value, keyed by field key. Client and business values are copied in, so a later
  -- change to the client or the business never changes this contract.
  field_values_json TEXT NOT NULL DEFAULT '{}',
  -- What the signer typed on the signing page, filled at signing.
  signer_values_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'viewed', 'signed', 'declined', 'expired', 'void')),
  signer_name TEXT,
  signer_email TEXT,
  signer_phone TEXT,
  link_days INTEGER NOT NULL DEFAULT 14 CHECK (link_days IN (7, 14, 30)),
  owner_sign INTEGER NOT NULL DEFAULT 0 CHECK (owner_sign IN (0, 1)),
  owner_signed_at TEXT,
  owner_signed_by INTEGER REFERENCES users (id),
  created_by INTEGER REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at TEXT,
  viewed_at TEXT,
  signed_at TEXT,
  declined_at TEXT,
  decline_reason TEXT,
  expires_at TEXT,
  void_at TEXT,
  sent_pdf_r2_key TEXT,
  sent_pdf_sha256 TEXT,
  signed_pdf_r2_key TEXT,
  signed_pdf_sha256 TEXT,
  -- Hash of the sent PDF hash, the signer inputs and the signature images, printed on the evidence page.
  signed_content_sha256 TEXT,
  -- How the signer was identified: 'email_code' or 'link_only'.
  identity_method TEXT CHECK (identity_method IN ('email_code', 'link_only')),
  -- The draft pro forma (type 300) made from a signed work order.
  linked_document_id INTEGER REFERENCES documents (id),
  -- The 07:00 cron sets this once it sent the 7-day unsigned alert.
  unsigned_alerted_at TEXT
);
CREATE INDEX contracts_business_client ON contracts (business_id, client_id, created_at);
CREATE INDEX contracts_business_status ON contracts (business_id, status, expires_at);

CREATE TRIGGER contracts_no_delete BEFORE DELETE ON contracts
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

CREATE TRIGGER contracts_same_business BEFORE INSERT ON contracts
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM clients WHERE id = NEW.client_id AND business_id = NEW.business_id)
     OR NOT EXISTS (SELECT 1 FROM contract_templates WHERE id = NEW.template_id AND business_id = NEW.business_id);
  SELECT RAISE(ABORT, 'contract_fixed') WHERE NEW.status <> 'draft';
END;

-- The rules a contract row keeps:
--   * business, client and kind never change.
--   * once sent, the template version, the filled values, the language and the sent PDF never change.
--   * once signed, nothing changes, except linked_document_id set once.
--   * void only for an unsigned contract, and a void contract stays void.
CREATE TRIGGER contracts_fixed BEFORE UPDATE ON contracts
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch')
  WHERE NEW.business_id IS NOT OLD.business_id OR NEW.client_id IS NOT OLD.client_id OR NEW.kind IS NOT OLD.kind OR NEW.id IS NOT OLD.id;
  SELECT RAISE(ABORT, 'contract_fixed')
  WHERE OLD.status <> 'draft' AND (
       NEW.template_id IS NOT OLD.template_id
    OR NEW.template_version IS NOT OLD.template_version
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
       NEW.status IS NOT OLD.status
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
    OR NEW.void_at IS NOT OLD.void_at
    OR NEW.declined_at IS NOT OLD.declined_at
    OR (OLD.linked_document_id IS NOT NULL AND NEW.linked_document_id IS NOT OLD.linked_document_id));
  SELECT RAISE(ABORT, 'contract_fixed')
  WHERE OLD.status IN ('void', 'declined') AND NEW.status IS NOT OLD.status AND NEW.status <> 'void';
  SELECT RAISE(ABORT, 'contract_fixed')
  WHERE OLD.status = 'void' AND (NEW.status IS NOT OLD.status OR NEW.void_at IS NOT OLD.void_at);
  SELECT RAISE(ABORT, 'contract_fixed')
  WHERE NEW.status = 'signed' AND OLD.status <> 'signed' AND (NEW.signed_at IS NULL OR NEW.signed_pdf_sha256 IS NULL OR OLD.status NOT IN ('sent', 'viewed'));
  SELECT RAISE(ABORT, 'contract_fixed')
  WHERE OLD.status <> 'signed' AND NEW.linked_document_id IS NOT NULL;
END;

-- One row per event. Never updated, never deleted.
CREATE TABLE contract_events (
  id INTEGER PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts (id),
  business_id INTEGER NOT NULL REFERENCES businesses (id),
  kind TEXT NOT NULL,
  actor_email TEXT,
  actor_role TEXT,
  ip TEXT,
  user_agent TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX contract_events_contract ON contract_events (contract_id, id);

CREATE TRIGGER contract_events_same_business BEFORE INSERT ON contract_events
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM contracts WHERE id = NEW.contract_id AND business_id = NEW.business_id);
END;

CREATE TRIGGER contract_events_no_update BEFORE UPDATE ON contract_events
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

CREATE TRIGGER contract_events_no_delete BEFORE DELETE ON contract_events
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

-- Email codes for the signing page. Only a hash is stored. 10 minutes, 5 tries.
CREATE TABLE contract_codes (
  id INTEGER PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts (id),
  code_hash TEXT NOT NULL,
  sent_to TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  confirmed_at TEXT,
  superseded INTEGER NOT NULL DEFAULT 0 CHECK (superseded IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX contract_codes_contract ON contract_codes (contract_id, id);

CREATE TRIGGER contract_codes_no_delete BEFORE DELETE ON contract_codes
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;
