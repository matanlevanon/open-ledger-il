-- R18 task 4: an optional description line on each document line, carried from the service
-- catalog's own description (items.description_en/description_he), editable on the line, printed
-- smaller and muted directly below the item name. Nullable: existing lines are unaffected.
-- Already frozen once a document is final, same as every other document_lines column: see
-- document_lines_frozen_update/insert/delete in 0002_integrity.sql, which block any change to a
-- final document's lines regardless of which column, so no trigger change is needed for these two.
ALTER TABLE document_lines ADD COLUMN detail_en TEXT;
ALTER TABLE document_lines ADD COLUMN detail_he TEXT;

-- Lets src/core/hashchain.ts include detail_en/detail_he in the hash of documents finalized from
-- now on, while a document finalized before this migration keeps hashing under the original line
-- field list, so its already-stored hash still verifies (CLAUDE.md rule 4's spirit: a schema
-- change here has an effective point, like a rate or a threshold). Every existing row defaults to
-- 1 (the pre-this-migration schema); finalizeDocument (src/core/numbering.ts) sets 2 explicitly
-- for every document finalized from here on. Frozen like every other documents column, per the
-- documents_immutable trigger this recreates (SQLite has no ALTER TRIGGER); test/core/
-- immutability.test.ts walks every column and would fail if this one were left out.
ALTER TABLE documents ADD COLUMN hash_schema_version INTEGER NOT NULL DEFAULT 1;

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
    OR NEW.hash IS NOT OLD.hash
    OR NEW.prev_hash IS NOT OLD.prev_hash
    OR NEW.finalized_at IS NOT OLD.finalized_at
    OR NEW.created_by IS NOT OLD.created_by
    OR NEW.version IS NOT OLD.version
    OR NEW.created_at IS NOT OLD.created_at;
END;
