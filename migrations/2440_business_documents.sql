-- R24 Phase C: business documents. Certificates a business keeps and shares: the VAT
-- registration, the company registration, the bookkeeping and withholding certificates, the bank
-- account confirmation. Files live in R2 under business/<business_id>/documents/<sha256>.<ext>,
-- write-once. A row is never deleted. A new upload of the same type replaces the current one,
-- and the older row stays listed with replaced_by set.

CREATE TABLE business_documents (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses (id),
  type TEXT NOT NULL CHECK (type IN ('vat_registration', 'company_registration', 'bookkeeping', 'withholding', 'bank_account', 'other')),
  r2_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  issue_date TEXT,
  valid_until TEXT,
  -- What the document reader found, as JSON. Null when no reader is set up.
  extracted_json TEXT,
  confirmed_at TEXT,
  replaced_by INTEGER REFERENCES business_documents (id),
  -- The 07:00 cron sets this once it opened the expiry task and sent the Slack alert.
  expiry_alerted_at TEXT,
  uploaded_by INTEGER REFERENCES users (id),
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX business_documents_business ON business_documents (business_id, type, uploaded_at);

CREATE TRIGGER business_documents_no_delete BEFORE DELETE ON business_documents
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

-- The file and who uploaded it never change. Dates and confirmation change until confirmed.
-- replaced_by is set once, to a newer document of the same business and type.
CREATE TRIGGER business_documents_fixed BEFORE UPDATE ON business_documents
BEGIN
  SELECT RAISE(ABORT, 'business_document_fixed')
  WHERE NEW.id IS NOT OLD.id
     OR NEW.business_id IS NOT OLD.business_id
     OR NEW.type IS NOT OLD.type
     OR NEW.r2_key IS NOT OLD.r2_key
     OR NEW.sha256 IS NOT OLD.sha256
     OR NEW.file_name IS NOT OLD.file_name
     OR NEW.content_type IS NOT OLD.content_type
     OR NEW.size_bytes IS NOT OLD.size_bytes
     OR NEW.extracted_json IS NOT OLD.extracted_json
     OR NEW.uploaded_by IS NOT OLD.uploaded_by
     OR NEW.uploaded_at IS NOT OLD.uploaded_at
     OR (OLD.confirmed_at IS NOT NULL AND (NEW.issue_date IS NOT OLD.issue_date OR NEW.valid_until IS NOT OLD.valid_until OR NEW.confirmed_at IS NOT OLD.confirmed_at))
     OR (OLD.replaced_by IS NOT NULL AND NEW.replaced_by IS NOT OLD.replaced_by)
     OR (OLD.expiry_alerted_at IS NOT NULL AND NEW.expiry_alerted_at IS NOT OLD.expiry_alerted_at);
  SELECT RAISE(ABORT, 'business_mismatch')
  WHERE NEW.replaced_by IS NOT NULL AND OLD.replaced_by IS NULL AND NOT EXISTS (
    SELECT 1 FROM business_documents n
    WHERE n.id = NEW.replaced_by AND n.id > OLD.id AND n.business_id = OLD.business_id AND n.type = OLD.type
  );
END;

-- Share links. The token is signed with SEND_LINK_KEY and names this row. Opening a link checks
-- the row: a revoked or expired link opens nothing. Every opening writes audit_log.
CREATE TABLE business_document_links (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses (id),
  document_id INTEGER NOT NULL REFERENCES business_documents (id),
  expires_at TEXT NOT NULL,
  -- Where the link went: 'link' (copied), 'email' or 'whatsapp'.
  channel TEXT NOT NULL DEFAULT 'link' CHECK (channel IN ('link', 'email', 'whatsapp')),
  sent_to TEXT,
  created_by INTEGER REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT,
  revoked_by INTEGER REFERENCES users (id),
  open_count INTEGER NOT NULL DEFAULT 0,
  last_opened_at TEXT
);
CREATE INDEX business_document_links_business ON business_document_links (business_id, revoked_at, expires_at);

CREATE TRIGGER business_document_links_no_delete BEFORE DELETE ON business_document_links
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

CREATE TRIGGER business_document_links_same_business BEFORE INSERT ON business_document_links
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM business_documents WHERE id = NEW.document_id AND business_id = NEW.business_id);
END;

-- A revoked link stays revoked. Only the revoke fields and the open counter change.
CREATE TRIGGER business_document_links_fixed BEFORE UPDATE ON business_document_links
BEGIN
  SELECT RAISE(ABORT, 'business_document_fixed')
  WHERE NEW.id IS NOT OLD.id
     OR NEW.business_id IS NOT OLD.business_id
     OR NEW.document_id IS NOT OLD.document_id
     OR NEW.expires_at IS NOT OLD.expires_at
     OR NEW.channel IS NOT OLD.channel
     OR NEW.sent_to IS NOT OLD.sent_to
     OR NEW.created_by IS NOT OLD.created_by
     OR NEW.created_at IS NOT OLD.created_at
     OR (OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS NOT OLD.revoked_at OR NEW.revoked_by IS NOT OLD.revoked_by));
END;
