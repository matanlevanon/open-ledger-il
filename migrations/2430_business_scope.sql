-- R24 Phase B: every row of business data names its business. Existing rows are business 1.
-- business_id is added without a REFERENCES clause: SQLite cannot add a foreign key column with a
-- non-null default while foreign keys are on. The guards below check the business instead.
-- Children of a document (lines, payments, links, meta, payment details, events, send log,
-- allocations) and of a client (contacts, consents) belong to the business of their parent.
-- Shared by every business, no column: users, vat_rates, thresholds, ceilings, vat_report_due_days,
-- fx_rates, document_types, unified_file_doc_type_codes, expense_categories, backups.

ALTER TABLE series ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE finalizations ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE clients ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE items ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE payment_methods ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE suppliers ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE expense_files ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE expenses ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE drive_import_runs ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ceiling_alerts ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE import_batches ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE history ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE audit_log ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ita_oauth_states ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE export_runs ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE external_document_uploads ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE external_documents ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE recurring_schedules ADD COLUMN business_id INTEGER NOT NULL DEFAULT 1;

-- The brand printed on a document (R23 task 4). Null on every document issued before brands, which
-- print the business profile as they always did. Frozen at finalize like every other column.
ALTER TABLE documents ADD COLUMN brand_id INTEGER;

CREATE INDEX series_business ON series (business_id, doc_type);
CREATE INDEX documents_business ON documents (business_id, status, type, date);
CREATE INDEX finalizations_business ON finalizations (business_id, seq);
CREATE INDEX clients_business ON clients (business_id);
CREATE INDEX expenses_business ON expenses (business_id, status, document_date);
CREATE INDEX audit_log_business ON audit_log (business_id, at);
CREATE INDEX tasks_business ON tasks (business_id);

-- One open series per document type, per business.
DROP INDEX series_one_open_per_type;
CREATE UNIQUE INDEX series_one_open_per_type ON series (business_id, doc_type) WHERE closed_at IS NULL;

-- ---------------------------------------------------------------------------
-- The hash chain is per business: prev_hash is the previous finalization of the same business.
-- Same checks as 0002_integrity.sql, plus the business of the series and the document.
-- ---------------------------------------------------------------------------
DROP TRIGGER finalizations_check;

CREATE TRIGGER finalizations_check BEFORE INSERT ON finalizations
BEGIN
  SELECT RAISE(ABORT, 'series_missing')
  WHERE NOT EXISTS (SELECT 1 FROM series WHERE id = NEW.series_id);
  SELECT RAISE(ABORT, 'series_closed')
  WHERE EXISTS (SELECT 1 FROM series WHERE id = NEW.series_id AND closed_at IS NOT NULL);
  SELECT RAISE(ABORT, 'not_draft')
  WHERE NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.document_id AND status = 'draft');
  SELECT RAISE(ABORT, 'series_mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.document_id AND series_id = NEW.series_id);
  SELECT RAISE(ABORT, 'business_mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM series WHERE id = NEW.series_id AND business_id = NEW.business_id)
     OR NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.document_id AND business_id = NEW.business_id);
  SELECT RAISE(ABORT, 'draft_changed')
  WHERE NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.document_id AND version = NEW.doc_version);
  SELECT RAISE(ABORT, 'number_conflict')
  WHERE NEW.number IS NOT (SELECT next_number FROM series WHERE id = NEW.series_id);
  SELECT RAISE(ABORT, 'chain_conflict')
  WHERE NEW.prev_hash IS NOT COALESCE(
    (SELECT hash FROM finalizations WHERE business_id = NEW.business_id ORDER BY seq DESC LIMIT 1),
    '0000000000000000000000000000000000000000000000000000000000000000'
  );
END;

-- A document lives in one business: its series, client and brand belong to that business.
CREATE TRIGGER documents_business_insert BEFORE INSERT ON documents
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM series WHERE id = NEW.series_id AND business_id = NEW.business_id)
     OR (NEW.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients WHERE id = NEW.client_id AND business_id = NEW.business_id))
     OR (NEW.brand_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM brands WHERE id = NEW.brand_id AND business_id = NEW.business_id));
END;

CREATE TRIGGER documents_business_update BEFORE UPDATE OF business_id, series_id, client_id, brand_id ON documents
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch')
  WHERE NEW.business_id IS NOT OLD.business_id
     OR NOT EXISTS (SELECT 1 FROM series WHERE id = NEW.series_id AND business_id = NEW.business_id)
     OR (NEW.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients WHERE id = NEW.client_id AND business_id = NEW.business_id))
     OR (NEW.brand_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM brands WHERE id = NEW.brand_id AND business_id = NEW.business_id));
END;

-- A document of one business never links, credits or converts to a document of another.
CREATE TRIGGER document_links_same_business BEFORE INSERT ON document_links
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch')
  WHERE (SELECT business_id FROM documents WHERE id = NEW.source_id) IS NOT (SELECT business_id FROM documents WHERE id = NEW.target_id);
END;

-- A series and a client never move between businesses.
CREATE TRIGGER series_business_fixed BEFORE UPDATE OF business_id ON series
WHEN NEW.business_id IS NOT OLD.business_id
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch');
END;

CREATE TRIGGER clients_business_fixed BEFORE UPDATE OF business_id ON clients
WHEN NEW.business_id IS NOT OLD.business_id
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch');
END;

-- ---------------------------------------------------------------------------
-- documents_immutable from 1801_line_description.sql, with business_id and brand_id frozen too.
-- ---------------------------------------------------------------------------
DROP TRIGGER documents_immutable;

CREATE TRIGGER documents_immutable BEFORE UPDATE ON documents
WHEN OLD.status IN ('final', 'cancelled', 'awaiting_allocation', 'allocation_pending', 'allocation_refused')
BEGIN
  SELECT RAISE(ABORT, 'invalid_status_transition')
  WHERE NEW.status IS NOT OLD.status
    AND NOT (
      (OLD.status = 'final' AND NEW.status = 'cancelled')
      OR (OLD.status = 'awaiting_allocation' AND NEW.status IN ('allocation_pending', 'allocation_refused', 'final'))
      OR (OLD.status = 'allocation_pending' AND NEW.status IN ('allocation_refused', 'final'))
      OR (OLD.status = 'allocation_refused' AND NEW.status IN ('final', 'cancelled'))
    );
  SELECT RAISE(ABORT, 'invalid_status_transition')
  WHERE NEW.status = 'cancelled'
    AND OLD.status IN ('final', 'allocation_refused')
    AND (NEW.cancelled_at IS NULL OR NEW.cancel_reason IS NULL OR trim(NEW.cancel_reason) = '');
  SELECT RAISE(ABORT, 'immutable_document')
  WHERE NOT (OLD.status IN ('final', 'allocation_refused') AND NEW.status = 'cancelled')
    AND (NEW.cancelled_at IS NOT OLD.cancelled_at OR NEW.cancel_reason IS NOT OLD.cancel_reason);
  SELECT RAISE(ABORT, 'immutable_document')
  WHERE NEW.pdf_hashes IS NOT OLD.pdf_hashes
    AND NOT (
      NEW.pdf_hashes IS NOT NULL
      AND json_valid(NEW.pdf_hashes)
      AND json_type(NEW.pdf_hashes) = 'array'
      AND (
        OLD.pdf_hashes IS NULL
        OR (
          json_array_length(NEW.pdf_hashes) > json_array_length(OLD.pdf_hashes)
          AND substr(NEW.pdf_hashes, 1, length(OLD.pdf_hashes) - 1)
              = substr(OLD.pdf_hashes, 1, length(OLD.pdf_hashes) - 1)
        )
      )
    );
  SELECT RAISE(ABORT, 'immutable_document')
  WHERE NEW.updated_at IS NOT OLD.updated_at
    AND NEW.status IS OLD.status
    AND NEW.pdf_hashes IS OLD.pdf_hashes;
  SELECT RAISE(ABORT, 'immutable_document')
  WHERE NEW.id IS NOT OLD.id
    OR NEW.type IS NOT OLD.type
    OR NEW.series_id IS NOT OLD.series_id
    OR NEW.number IS NOT OLD.number
    OR NEW.legal_mode IS NOT OLD.legal_mode
    OR NEW.client_id IS NOT OLD.client_id
    OR NEW.date IS NOT OLD.date
    OR NEW.issuance_date IS NOT OLD.issuance_date
    OR NEW.due_date IS NOT OLD.due_date
    OR NEW.currency IS NOT OLD.currency
    OR NEW.fx_rate IS NOT OLD.fx_rate
    OR NEW.fx_rate_date IS NOT OLD.fx_rate_date
    OR NEW.fx_source IS NOT OLD.fx_source
    OR NEW.subtotal_minor IS NOT OLD.subtotal_minor
    OR NEW.vat_rate_bp IS NOT OLD.vat_rate_bp
    OR NEW.vat_amount_minor IS NOT OLD.vat_amount_minor
    OR NEW.total_minor IS NOT OLD.total_minor
    OR NEW.total_ils_minor IS NOT OLD.total_ils_minor
    OR (
      NEW.allocation_number IS NOT OLD.allocation_number
      AND OLD.status NOT IN ('awaiting_allocation', 'allocation_pending', 'allocation_refused')
    )
    OR NEW.lang_variant IS NOT OLD.lang_variant
    OR NEW.notes IS NOT OLD.notes
    OR NEW.payment_instructions IS NOT OLD.payment_instructions
    OR NEW.payment_method_ids IS NOT OLD.payment_method_ids
    OR NEW.hash_schema_version IS NOT OLD.hash_schema_version
    OR NEW.business_id IS NOT OLD.business_id
    OR NEW.brand_id IS NOT OLD.brand_id
    OR NEW.hash IS NOT OLD.hash
    OR NEW.prev_hash IS NOT OLD.prev_hash
    OR NEW.finalized_at IS NOT OLD.finalized_at
    OR NEW.created_by IS NOT OLD.created_by
    OR NEW.version IS NOT OLD.version
    OR NEW.created_at IS NOT OLD.created_at;
END;

-- ---------------------------------------------------------------------------
-- The business type lock (2410) moves to businesses, per business.
-- ---------------------------------------------------------------------------
CREATE TRIGGER businesses_entity_type_lock BEFORE UPDATE OF entity_type ON businesses
WHEN NEW.entity_type IS NOT OLD.entity_type
BEGIN
  SELECT RAISE(ABORT, 'entity_type_locked')
  WHERE NOT (
    (OLD.entity_type = 'osek_patur' AND NEW.entity_type = 'osek_murshe')
    OR (OLD.entity_type = 'osek_patur' AND NEW.entity_type = 'company'
        AND NOT EXISTS (SELECT 1 FROM finalizations WHERE business_id = OLD.id))
  );
END;

CREATE TRIGGER businesses_insert_lock BEFORE INSERT ON businesses
WHEN NEW.entity_type = 'osek_patur' AND EXISTS (SELECT 1 FROM legal_modes WHERE mode = 'murshe' AND business_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'entity_type_locked');
END;

-- A business is never deleted. Its documents, numbers and chain stay.
CREATE TRIGGER businesses_no_delete BEFORE DELETE ON businesses
BEGIN
  SELECT RAISE(ABORT, 'entity_type_locked') WHERE OLD.entity_type IS NOT 'osek_patur';
  SELECT RAISE(ABORT, 'business_locked');
END;

CREATE TRIGGER businesses_id_fixed BEFORE UPDATE OF id ON businesses
WHEN NEW.id IS NOT OLD.id
BEGIN
  SELECT RAISE(ABORT, 'business_locked');
END;
