-- R16 task 7: payment instructions. A business-level default, a per-client override that the
-- last used document text is saved back to, and the frozen text on the document itself.
ALTER TABLE business_profile ADD COLUMN payment_instructions TEXT;
ALTER TABLE clients ADD COLUMN payment_instructions TEXT;
ALTER TABLE documents ADD COLUMN payment_instructions TEXT;

-- CLAUDE.md rule 1: a final document never changes. `documents_immutable` freezes documents by
-- an explicit column list (SQLite has no ALTER TRIGGER, so a new column needs the trigger
-- recreated to cover it). The trigger currently in force is migrations/1100_murshe.sql's version,
-- not 0002_integrity.sql's original: 1100 extended the WHEN clause and the status-transition
-- whitelist to also freeze the three allocation statuses. This migration carries that version
-- forward unchanged, adding only `payment_instructions` to the final OR list.
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
    OR NEW.hash IS NOT OLD.hash
    OR NEW.prev_hash IS NOT OLD.prev_hash
    OR NEW.finalized_at IS NOT OLD.finalized_at
    OR NEW.created_by IS NOT OLD.created_by
    OR NEW.version IS NOT OLD.version
    OR NEW.created_at IS NOT OLD.created_at;
END;
