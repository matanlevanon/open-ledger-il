-- R11 murshe. Owned by R11 (range 1100-1199).
--
-- Note from R00b (runs/R11-murshe.md): the ITA Approval call sends the invoice number, so the
-- number is assigned before the call. The finalize transaction now writes a qualifying tax
-- invoice as 'awaiting_allocation' instead of 'final' (docs/israel-invoices-api.md §7). This
-- migration recreates the triggers that gate that step and the ones that freeze a numbered row,
-- so both cover the three allocation statuses without weakening immutability of a `final` row.
--
-- `finalizations_check` (0002_integrity.sql) needs no change: it only ever fires once per
-- document, on the INSERT that happens while the document is still `draft`, and that stays true
-- whether the finalize UPDATE that follows lands on 'final' or 'awaiting_allocation'.

-- ---------------------------------------------------------------------------
-- documents_finalize_guard: draft -> final now also accepts draft -> awaiting_allocation, both
-- only together with the matching `finalizations` row from the same transaction. Fires only while
-- OLD.status = 'draft': every other status is a numbered row, now covered by documents_immutable.
-- ---------------------------------------------------------------------------
DROP TRIGGER documents_finalize_guard;

CREATE TRIGGER documents_finalize_guard BEFORE UPDATE ON documents
WHEN OLD.status = 'draft'
BEGIN
  SELECT RAISE(ABORT, 'invalid_status_transition')
  WHERE NEW.status IN ('cancelled', 'allocation_pending', 'allocation_refused');
  SELECT RAISE(ABORT, 'final_requires_finalization')
  WHERE (NEW.status IN ('final', 'awaiting_allocation') OR NEW.number IS NOT NULL OR NEW.hash IS NOT NULL
         OR NEW.prev_hash IS NOT NULL OR NEW.finalized_at IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM finalizations f
      WHERE f.document_id = OLD.id
        AND f.series_id = NEW.series_id
        AND f.number = NEW.number
        AND f.hash = NEW.hash
        AND f.prev_hash = NEW.prev_hash
        AND NEW.status IN ('final', 'awaiting_allocation')
        AND NEW.version = OLD.version
    );
END;

-- ---------------------------------------------------------------------------
-- documents_immutable: was WHEN OLD.status IN ('final', 'cancelled'). Now also covers the three
-- allocation statuses, since a document in one of them is numbered and hashed, the same as
-- 'final'. Two things change from the 0002 version:
--   - the status-transition whitelist grows to the allocation flow's forward-only path
--     (awaiting_allocation -> allocation_pending | allocation_refused | final,
--      allocation_pending -> allocation_refused | final, allocation_refused -> final | cancelled)
--   - allocation_number may change while OLD.status is one of the three allocation statuses (the
--     ITA flow, src/modules/ita/documents.ts D1AllocationDocuments.setStatus, writes it together
--     with the status move); it stays frozen once OLD.status is 'final' or 'cancelled', same as
--     every other column.
-- Everything else (cancelled_at/cancel_reason only with final -> cancelled or allocation_refused
-- -> cancelled, pdf_hashes append-only, updated_at only with one of those, every other column
-- frozen) is unchanged from 0002_integrity.sql.
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
    OR NEW.hash IS NOT OLD.hash
    OR NEW.prev_hash IS NOT OLD.prev_hash
    OR NEW.finalized_at IS NOT OLD.finalized_at
    OR NEW.created_by IS NOT OLD.created_by
    OR NEW.version IS NOT OLD.version
    OR NEW.created_at IS NOT OLD.created_at;
END;

-- ---------------------------------------------------------------------------
-- documents_no_delete already covers every numbered row (OLD.number IS NOT NULL), which includes
-- the three allocation statuses. No change.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- documents_draft_version: was WHEN OLD.status NOT IN ('final', 'cancelled') AND NEW.status NOT IN
-- ('final', 'cancelled') AND NEW.version = OLD.version, so that every draft-editing UPDATE bumps
-- version without the caller having to compute it. It never used to fire during finalize, because
-- finalize always set NEW.status to 'final'. Now finalize can set NEW.status to
-- 'awaiting_allocation' instead, which the old WHEN clause reads as just another draft edit: it
-- bumps version on the row finalize just numbered, which documents_immutable then rightly refuses
-- (version is frozen the moment a document is numbered), breaking finalize itself. The fix is
-- narrower than "not final or cancelled": only a true draft-to-draft edit bumps version.
-- ---------------------------------------------------------------------------
DROP TRIGGER documents_draft_version;

CREATE TRIGGER documents_draft_version AFTER UPDATE ON documents
WHEN OLD.status = 'draft'
  AND NEW.status = 'draft'
  AND NEW.version = OLD.version
BEGIN
  UPDATE documents SET version = OLD.version + 1 WHERE id = NEW.id;
END;

-- ---------------------------------------------------------------------------
-- document_lines, payments and document_links: "frozen" triggers extended from
-- status IN ('final', 'cancelled') to also cover the three allocation statuses. A numbered
-- document's lines, payments and links are frozen the moment it leaves 'draft', not only once
-- it reaches 'final'.
-- ---------------------------------------------------------------------------
DROP TRIGGER document_lines_frozen_insert;
DROP TRIGGER document_lines_frozen_update;
DROP TRIGGER document_lines_frozen_delete;

CREATE TRIGGER document_lines_frozen_insert BEFORE INSERT ON document_lines
WHEN EXISTS (
  SELECT 1 FROM documents
  WHERE id = NEW.document_id
    AND status IN ('final', 'cancelled', 'awaiting_allocation', 'allocation_pending', 'allocation_refused')
)
BEGIN
  SELECT RAISE(ABORT, 'immutable_line');
END;

CREATE TRIGGER document_lines_frozen_update BEFORE UPDATE ON document_lines
WHEN EXISTS (
  SELECT 1 FROM documents
  WHERE id IN (OLD.document_id, NEW.document_id)
    AND status IN ('final', 'cancelled', 'awaiting_allocation', 'allocation_pending', 'allocation_refused')
)
BEGIN
  SELECT RAISE(ABORT, 'immutable_line');
END;

CREATE TRIGGER document_lines_frozen_delete BEFORE DELETE ON document_lines
WHEN EXISTS (
  SELECT 1 FROM documents
  WHERE id = OLD.document_id
    AND status IN ('final', 'cancelled', 'awaiting_allocation', 'allocation_pending', 'allocation_refused')
)
BEGIN
  SELECT RAISE(ABORT, 'immutable_line');
END;

DROP TRIGGER payments_frozen_insert;
DROP TRIGGER payments_frozen_update;
DROP TRIGGER payments_frozen_delete;

CREATE TRIGGER payments_frozen_insert BEFORE INSERT ON payments
WHEN EXISTS (
  SELECT 1 FROM documents
  WHERE id = NEW.document_id
    AND status IN ('final', 'cancelled', 'awaiting_allocation', 'allocation_pending', 'allocation_refused')
)
BEGIN
  SELECT RAISE(ABORT, 'immutable_payment');
END;

CREATE TRIGGER payments_frozen_update BEFORE UPDATE ON payments
WHEN EXISTS (
  SELECT 1 FROM documents
  WHERE id IN (OLD.document_id, NEW.document_id)
    AND status IN ('final', 'cancelled', 'awaiting_allocation', 'allocation_pending', 'allocation_refused')
)
BEGIN
  SELECT RAISE(ABORT, 'immutable_payment');
END;

CREATE TRIGGER payments_frozen_delete BEFORE DELETE ON payments
WHEN EXISTS (
  SELECT 1 FROM documents
  WHERE id = OLD.document_id
    AND status IN ('final', 'cancelled', 'awaiting_allocation', 'allocation_pending', 'allocation_refused')
)
BEGIN
  SELECT RAISE(ABORT, 'immutable_payment');
END;

DROP TRIGGER document_links_frozen_update;
DROP TRIGGER document_links_frozen_delete;

CREATE TRIGGER document_links_frozen_update BEFORE UPDATE ON document_links
WHEN EXISTS (
  SELECT 1 FROM documents
  WHERE id IN (OLD.source_id, OLD.target_id)
    AND status IN ('final', 'cancelled', 'awaiting_allocation', 'allocation_pending', 'allocation_refused')
)
BEGIN
  SELECT RAISE(ABORT, 'immutable_link');
END;

CREATE TRIGGER document_links_frozen_delete BEFORE DELETE ON document_links
WHEN EXISTS (
  SELECT 1 FROM documents
  WHERE id IN (OLD.source_id, OLD.target_id)
    AND status IN ('final', 'cancelled', 'awaiting_allocation', 'allocation_pending', 'allocation_refused')
)
BEGIN
  SELECT RAISE(ABORT, 'immutable_link');
END;

-- ---------------------------------------------------------------------------
-- Open items for the עוסק מורשה switch (docs/legal-requirements.md, "Switch from פטור to
-- מורשה", point 4): the 15-day VAT-office notice, and a place to track the 14-day
-- tax-invoice-after-payment deadline later. One row per open legal task.
-- ---------------------------------------------------------------------------
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  document_id INTEGER REFERENCES documents (id),
  due_at TEXT NOT NULL,
  alert_at TEXT,
  alerted_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
  done_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX tasks_status ON tasks (status, due_at);
CREATE INDEX tasks_document ON tasks (document_id);

CREATE TRIGGER tasks_no_delete BEFORE DELETE ON tasks
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;
