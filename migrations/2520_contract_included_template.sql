-- R25b: the Standard Terms and a Work Order in one PDF, signed once.
-- A work order can include a contract-kind template (the Standard Terms) printed before it.
-- Both columns stay NULL for every contract made before this run.
ALTER TABLE contracts ADD COLUMN included_template_id INTEGER REFERENCES contract_templates (id);
ALTER TABLE contracts ADD COLUMN included_template_version INTEGER;

-- The included template belongs to the same business, on insert and on every change of a draft.
DROP TRIGGER contracts_same_business;
CREATE TRIGGER contracts_same_business BEFORE INSERT ON contracts
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM clients WHERE id = NEW.client_id AND business_id = NEW.business_id)
     OR NOT EXISTS (SELECT 1 FROM contract_templates WHERE id = NEW.template_id AND business_id = NEW.business_id)
     OR (NEW.included_template_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM contract_templates WHERE id = NEW.included_template_id AND business_id = NEW.business_id));
  SELECT RAISE(ABORT, 'contract_fixed') WHERE NEW.status <> 'draft';
END;

-- Rebuilt from 2500 with the two new columns fixed once sent, the same as template_id and
-- template_version. Every other rule is copied unchanged.
DROP TRIGGER contracts_fixed;
CREATE TRIGGER contracts_fixed BEFORE UPDATE ON contracts
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch')
  WHERE NEW.business_id IS NOT OLD.business_id OR NEW.client_id IS NOT OLD.client_id OR NEW.kind IS NOT OLD.kind OR NEW.id IS NOT OLD.id;
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

-- A version a sent contract uses never changes, whether as its template or as its included template.
DROP TRIGGER contract_template_versions_fixed;
CREATE TRIGGER contract_template_versions_fixed BEFORE UPDATE ON contract_template_versions
BEGIN
  SELECT RAISE(ABORT, 'contract_fixed')
  WHERE NEW.id IS NOT OLD.id OR NEW.template_id IS NOT OLD.template_id OR NEW.business_id IS NOT OLD.business_id
     OR NEW.version IS NOT OLD.version OR NEW.kind IS NOT OLD.kind
     OR EXISTS (SELECT 1 FROM contracts WHERE template_id = OLD.template_id AND template_version = OLD.version AND status <> 'draft')
     OR EXISTS (SELECT 1 FROM contracts WHERE included_template_id = OLD.template_id AND included_template_version = OLD.version AND status <> 'draft');
END;
