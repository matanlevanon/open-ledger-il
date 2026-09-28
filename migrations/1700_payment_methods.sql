-- R17 task 2: a reusable payment-methods catalog, replacing the free-text payment instructions
-- block with a structured, multi-select list. Type-specific fields (bank transfer needs eight;
-- Bit needs a phone) live in `details` as JSON rather than one column per type.
CREATE TABLE payment_methods (
  id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('bank_transfer', 'bit', 'paybox', 'paypal', 'card', 'cash', 'cheque', 'other')),
  -- NULL = any currency.
  currency TEXT,
  details TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- `payment_instructions` (added in 1601) stays as the free-text note next to the multi-select;
-- no data migration is needed since existing text keeps living in that same column. See the R17
-- run's PR body for the reasoning.

-- The multi-select on a quote, payment request, proforma or transaction invoice: a JSON array of
-- payment_methods.id, frozen once the document is final like every other printed field.
ALTER TABLE documents ADD COLUMN payment_method_ids TEXT;

-- The last-used selection per client (mirrors payment_instructions' R16 task 7 default pattern)
-- and the business-level fallback for a client with none of its own.
ALTER TABLE clients ADD COLUMN payment_method_ids TEXT;
ALTER TABLE business_profile ADD COLUMN payment_method_ids TEXT;

-- The configured method actually used to record one payment, for printing its details on the
-- receipt (instruction 17). `payments.method` stays the legacy bucket the immutable-payment
-- triggers and the instruction-18ב(ד) secured-signature check already key off; `method_id` is an
-- additive reference to the catalog, nullable so a payment recorded before this migration (or a
-- test that never sets up a catalog) stays valid.
ALTER TABLE payments ADD COLUMN method_id INTEGER REFERENCES payment_methods (id);

-- CLAUDE.md rule 1: a final document never changes. Recreate documents_immutable (SQLite has no
-- ALTER TRIGGER) to also freeze payment_method_ids, carrying forward 1601's version unchanged
-- otherwise.
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
    OR NEW.hash IS NOT OLD.hash
    OR NEW.prev_hash IS NOT OLD.prev_hash
    OR NEW.finalized_at IS NOT OLD.finalized_at
    OR NEW.created_by IS NOT OLD.created_by
    OR NEW.version IS NOT OLD.version
    OR NEW.created_at IS NOT OLD.created_at;
END;
