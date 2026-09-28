-- R00 integrity triggers. CLAUDE.md rules 1 and 2. Never drop or weaken these.
-- A run that adds a column to documents, document_lines or payments must recreate the matching
-- trigger with the new column in its frozen list. test/core/immutability.test.ts walks every
-- column and fails when one is left out.
--
-- Error codes raised here are mapped to typed errors in src/core/errors.ts.

-- ---------------------------------------------------------------------------
-- finalizations: the finalize transaction and the only source of numbers
-- ---------------------------------------------------------------------------

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
  SELECT RAISE(ABORT, 'draft_changed')
  WHERE NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.document_id AND version = NEW.doc_version);
  SELECT RAISE(ABORT, 'number_conflict')
  WHERE NEW.number IS NOT (SELECT next_number FROM series WHERE id = NEW.series_id);
  SELECT RAISE(ABORT, 'chain_conflict')
  WHERE NEW.prev_hash IS NOT COALESCE(
    (SELECT hash FROM finalizations ORDER BY seq DESC LIMIT 1),
    '0000000000000000000000000000000000000000000000000000000000000000'
  );
END;

CREATE TRIGGER finalizations_advance_series AFTER INSERT ON finalizations
BEGIN
  UPDATE series
  SET next_number = NEW.number + 1,
      started_at = COALESCE(started_at, NEW.finalized_at)
  WHERE id = NEW.series_id;
END;

CREATE TRIGGER finalizations_no_update BEFORE UPDATE ON finalizations
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

CREATE TRIGGER finalizations_no_delete BEFORE DELETE ON finalizations
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

-- ---------------------------------------------------------------------------
-- series: start number settable once, numbers only move by one, closed stays closed
-- ---------------------------------------------------------------------------

CREATE TRIGGER series_guard BEFORE UPDATE ON series
BEGIN
  SELECT RAISE(ABORT, 'series_reopen')
  WHERE OLD.closed_at IS NOT NULL AND NEW.closed_at IS NOT OLD.closed_at;
  SELECT RAISE(ABORT, 'series_started')
  WHERE NEW.id IS NOT OLD.id OR NEW.doc_type IS NOT OLD.doc_type;
  SELECT RAISE(ABORT, 'series_started')
  WHERE OLD.started_at IS NOT NULL
    AND (NEW.start_number IS NOT OLD.start_number OR NEW.started_at IS NOT OLD.started_at);
  SELECT RAISE(ABORT, 'series_sequence')
  WHERE OLD.started_at IS NULL
    AND NEW.start_number IS NOT OLD.start_number
    AND NEW.next_number IS NOT NEW.start_number;
  SELECT RAISE(ABORT, 'series_sequence')
  WHERE NEW.next_number IS NOT OLD.next_number
    AND NOT (
      NEW.next_number = OLD.next_number + 1
      AND EXISTS (SELECT 1 FROM finalizations WHERE series_id = OLD.id AND number = OLD.next_number)
    )
    AND NOT (OLD.started_at IS NULL AND NEW.next_number = NEW.start_number);
END;

CREATE TRIGGER series_no_delete BEFORE DELETE ON series
WHEN OLD.started_at IS NOT NULL
  OR EXISTS (SELECT 1 FROM documents WHERE series_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'series_started');
END;

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------

-- A document is born as a draft. Number, hash and final status come from finalize only.
CREATE TRIGGER documents_insert_guard BEFORE INSERT ON documents
WHEN NEW.status IN ('final', 'cancelled')
  OR NEW.number IS NOT NULL
  OR NEW.hash IS NOT NULL
  OR NEW.prev_hash IS NOT NULL
  OR NEW.finalized_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'final_requires_finalization');
END;

-- Leaving draft for final needs a matching finalizations row written in the same transaction.
CREATE TRIGGER documents_finalize_guard BEFORE UPDATE ON documents
WHEN OLD.status NOT IN ('final', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'invalid_status_transition')
  WHERE NEW.status = 'cancelled';
  SELECT RAISE(ABORT, 'final_requires_finalization')
  WHERE (NEW.status = 'final' OR NEW.number IS NOT NULL OR NEW.hash IS NOT NULL
         OR NEW.prev_hash IS NOT NULL OR NEW.finalized_at IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM finalizations f
      WHERE f.document_id = OLD.id
        AND f.series_id = NEW.series_id
        AND f.number = NEW.number
        AND f.hash = NEW.hash
        AND f.prev_hash = NEW.prev_hash
        AND NEW.status = 'final'
        AND NEW.version = OLD.version
    );
END;

-- Every draft change bumps version. Recursive triggers are off, so this fires once.
CREATE TRIGGER documents_draft_version AFTER UPDATE ON documents
WHEN OLD.status NOT IN ('final', 'cancelled')
  AND NEW.status NOT IN ('final', 'cancelled')
  AND NEW.version = OLD.version
BEGIN
  UPDATE documents SET version = OLD.version + 1 WHERE id = NEW.id;
END;

-- Final and cancelled rows are frozen. Whitelist:
--   status: final -> cancelled, with cancelled_at and a non-empty cancel_reason set at the same time
--   pdf_hashes: NULL -> JSON array, or append to the existing JSON array
--   updated_at: only together with one of the two changes above
CREATE TRIGGER documents_immutable BEFORE UPDATE ON documents
WHEN OLD.status IN ('final', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'invalid_status_transition')
  WHERE NEW.status IS NOT OLD.status
    AND NOT (OLD.status = 'final' AND NEW.status = 'cancelled');
  SELECT RAISE(ABORT, 'invalid_status_transition')
  WHERE OLD.status = 'final' AND NEW.status = 'cancelled'
    AND (NEW.cancelled_at IS NULL OR NEW.cancel_reason IS NULL OR trim(NEW.cancel_reason) = '');
  SELECT RAISE(ABORT, 'immutable_document')
  WHERE NOT (OLD.status = 'final' AND NEW.status = 'cancelled')
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
    OR NEW.allocation_number IS NOT OLD.allocation_number
    OR NEW.lang_variant IS NOT OLD.lang_variant
    OR NEW.notes IS NOT OLD.notes
    OR NEW.hash IS NOT OLD.hash
    OR NEW.prev_hash IS NOT OLD.prev_hash
    OR NEW.finalized_at IS NOT OLD.finalized_at
    OR NEW.created_by IS NOT OLD.created_by
    OR NEW.version IS NOT OLD.version
    OR NEW.created_at IS NOT OLD.created_at;
END;

CREATE TRIGGER documents_no_delete BEFORE DELETE ON documents
WHEN OLD.status IN ('final', 'cancelled') OR OLD.number IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'immutable_document');
END;

-- ---------------------------------------------------------------------------
-- document_lines and payments of final documents
-- ---------------------------------------------------------------------------

CREATE TRIGGER document_lines_frozen_insert BEFORE INSERT ON document_lines
WHEN EXISTS (SELECT 1 FROM documents WHERE id = NEW.document_id AND status IN ('final', 'cancelled'))
BEGIN
  SELECT RAISE(ABORT, 'immutable_line');
END;

CREATE TRIGGER document_lines_frozen_update BEFORE UPDATE ON document_lines
WHEN EXISTS (
  SELECT 1 FROM documents
  WHERE id IN (OLD.document_id, NEW.document_id) AND status IN ('final', 'cancelled')
)
BEGIN
  SELECT RAISE(ABORT, 'immutable_line');
END;

CREATE TRIGGER document_lines_frozen_delete BEFORE DELETE ON document_lines
WHEN EXISTS (SELECT 1 FROM documents WHERE id = OLD.document_id AND status IN ('final', 'cancelled'))
BEGIN
  SELECT RAISE(ABORT, 'immutable_line');
END;

CREATE TRIGGER document_lines_bump_insert AFTER INSERT ON document_lines
BEGIN
  UPDATE documents SET version = version + 1
  WHERE id = NEW.document_id AND status NOT IN ('final', 'cancelled');
END;

CREATE TRIGGER document_lines_bump_update AFTER UPDATE ON document_lines
BEGIN
  UPDATE documents SET version = version + 1
  WHERE id IN (OLD.document_id, NEW.document_id) AND status NOT IN ('final', 'cancelled');
END;

CREATE TRIGGER document_lines_bump_delete AFTER DELETE ON document_lines
BEGIN
  UPDATE documents SET version = version + 1
  WHERE id = OLD.document_id AND status NOT IN ('final', 'cancelled');
END;

CREATE TRIGGER payments_frozen_insert BEFORE INSERT ON payments
WHEN EXISTS (SELECT 1 FROM documents WHERE id = NEW.document_id AND status IN ('final', 'cancelled'))
BEGIN
  SELECT RAISE(ABORT, 'immutable_payment');
END;

CREATE TRIGGER payments_frozen_update BEFORE UPDATE ON payments
WHEN EXISTS (
  SELECT 1 FROM documents
  WHERE id IN (OLD.document_id, NEW.document_id) AND status IN ('final', 'cancelled')
)
BEGIN
  SELECT RAISE(ABORT, 'immutable_payment');
END;

CREATE TRIGGER payments_frozen_delete BEFORE DELETE ON payments
WHEN EXISTS (SELECT 1 FROM documents WHERE id = OLD.document_id AND status IN ('final', 'cancelled'))
BEGIN
  SELECT RAISE(ABORT, 'immutable_payment');
END;

CREATE TRIGGER payments_bump_insert AFTER INSERT ON payments
BEGIN
  UPDATE documents SET version = version + 1
  WHERE id = NEW.document_id AND status NOT IN ('final', 'cancelled');
END;

CREATE TRIGGER payments_bump_update AFTER UPDATE ON payments
BEGIN
  UPDATE documents SET version = version + 1
  WHERE id IN (OLD.document_id, NEW.document_id) AND status NOT IN ('final', 'cancelled');
END;

CREATE TRIGGER payments_bump_delete AFTER DELETE ON payments
BEGIN
  UPDATE documents SET version = version + 1
  WHERE id = OLD.document_id AND status NOT IN ('final', 'cancelled');
END;

-- Links may be added to a final document, never changed or removed.
CREATE TRIGGER document_links_frozen_update BEFORE UPDATE ON document_links
WHEN EXISTS (
  SELECT 1 FROM documents
  WHERE id IN (OLD.source_id, OLD.target_id) AND status IN ('final', 'cancelled')
)
BEGIN
  SELECT RAISE(ABORT, 'immutable_link');
END;

CREATE TRIGGER document_links_frozen_delete BEFORE DELETE ON document_links
WHEN EXISTS (
  SELECT 1 FROM documents
  WHERE id IN (OLD.source_id, OLD.target_id) AND status IN ('final', 'cancelled')
)
BEGIN
  SELECT RAISE(ABORT, 'immutable_link');
END;

-- ---------------------------------------------------------------------------
-- audit_log is append-only
-- ---------------------------------------------------------------------------

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;
