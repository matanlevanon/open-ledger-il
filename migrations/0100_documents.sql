-- R01: clients, client book, פטור documents, payments, links, credits.
-- Adds side tables only. R00 tables and triggers stay as they are. The triggers below only add checks.
-- Error codes raised here are mapped in src/modules/documents/errors.ts.

-- ---------------------------------------------------------------------------
-- Document types. R11 enables 305, 320, 330 and 332 and opens their series.
-- kind: quote, demand (asks for money), receipt, credit (credit receipt), invoice, invoice_receipt, credit_invoice
-- modes: legal modes the type is valid in ('both', 'patur', 'murshe')
-- ---------------------------------------------------------------------------
CREATE TABLE document_types (
  code TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_he TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('quote', 'demand', 'receipt', 'credit', 'invoice', 'invoice_receipt', 'credit_invoice')),
  modes TEXT NOT NULL CHECK (modes IN ('both', 'patur', 'murshe')),
  bookkeeping INTEGER NOT NULL CHECK (bookkeeping IN (0, 1)),
  credit_type TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO document_types (code, name_en, name_he, kind, modes, bookkeeping, credit_type, sort_order, enabled) VALUES
  ('QT', 'Quote', 'הצעת מחיר', 'quote', 'both', 0, NULL, 10, 1),
  ('PR', 'Payment request', 'דרישת תשלום', 'demand', 'both', 0, NULL, 20, 1),
  ('300', 'Transaction invoice', 'חשבון עסקה', 'demand', 'both', 1, NULL, 30, 1),
  ('400', 'Receipt', 'קבלה', 'receipt', 'both', 1, '405', 40, 1),
  ('405', 'Credit receipt', 'קבלת זיכוי', 'credit', 'both', 1, NULL, 50, 1),
  ('305', 'Tax invoice', 'חשבונית מס', 'invoice', 'murshe', 1, '330', 60, 0),
  ('320', 'Tax invoice receipt', 'חשבונית מס/קבלה', 'invoice_receipt', 'murshe', 1, '330', 70, 0),
  ('330', 'Credit tax invoice', 'חשבונית זיכוי', 'credit_invoice', 'murshe', 1, NULL, 80, 0),
  ('332', 'Transaction invoice with advance approval', 'חשבון עסקה באישור מראש', 'demand', 'murshe', 1, NULL, 90, 0);

-- ---------------------------------------------------------------------------
-- Client contacts. Not bookkeeping records, so plain CRUD.
-- ---------------------------------------------------------------------------
CREATE TABLE client_contacts (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients (id),
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX client_contacts_client ON client_contacts (client_id);

-- ---------------------------------------------------------------------------
-- Per-document options that have no column in documents. Frozen with the document.
--   source_id, source_kind: the document this draft was created from. Finalize turns it into a document_links row.
--   revises_id: the quote or payment request this draft replaces. Finalize cancels the original.
--   show_ils: print an indicative or agreed ILS line on a quote, payment request or חשבון עסקה.
--   carry_rate: receipts created from this document use its rate instead of the payment-date rate.
-- ---------------------------------------------------------------------------
CREATE TABLE document_meta (
  document_id INTEGER PRIMARY KEY REFERENCES documents (id),
  source_id INTEGER REFERENCES documents (id),
  source_kind TEXT CHECK (source_kind IN ('converted', 'payment', 'credit')),
  revises_id INTEGER REFERENCES documents (id),
  show_ils INTEGER NOT NULL DEFAULT 0 CHECK (show_ils IN (0, 1)),
  carry_rate INTEGER NOT NULL DEFAULT 0 CHECK (carry_rate IN (0, 1)),
  backdate_reason TEXT,
  credit_reason TEXT
);
CREATE INDEX document_meta_source ON document_meta (source_id);

CREATE TRIGGER document_meta_frozen_insert BEFORE INSERT ON document_meta
WHEN EXISTS (SELECT 1 FROM documents WHERE id = NEW.document_id AND status NOT IN ('draft'))
BEGIN
  SELECT RAISE(ABORT, 'immutable_document');
END;

CREATE TRIGGER document_meta_frozen_update BEFORE UPDATE ON document_meta
WHEN EXISTS (
  SELECT 1 FROM documents WHERE id IN (OLD.document_id, NEW.document_id) AND status NOT IN ('draft')
)
BEGIN
  SELECT RAISE(ABORT, 'immutable_document');
END;

CREATE TRIGGER document_meta_frozen_delete BEFORE DELETE ON document_meta
WHEN EXISTS (SELECT 1 FROM documents WHERE id = OLD.document_id AND status NOT IN ('draft'))
BEGIN
  SELECT RAISE(ABORT, 'immutable_document');
END;

-- Draft changes to the meta row bump the draft version, like lines and payments do.
CREATE TRIGGER document_meta_bump_insert AFTER INSERT ON document_meta
BEGIN
  UPDATE documents SET version = version + 1 WHERE id = NEW.document_id AND status = 'draft';
END;

CREATE TRIGGER document_meta_bump_update AFTER UPDATE ON document_meta
BEGIN
  UPDATE documents SET version = version + 1 WHERE id = NEW.document_id AND status = 'draft';
END;

-- ---------------------------------------------------------------------------
-- Payment details that have no column in payments. Frozen with the document.
-- cheque_crossed: a crossed cheque, one of the methods allowed under instruction 18ב(ד).
-- ---------------------------------------------------------------------------
CREATE TABLE payment_details (
  payment_id INTEGER PRIMARY KEY REFERENCES payments (id),
  cheque_crossed INTEGER NOT NULL DEFAULT 0 CHECK (cheque_crossed IN (0, 1))
);

CREATE TRIGGER payment_details_frozen_insert BEFORE INSERT ON payment_details
WHEN EXISTS (
  SELECT 1 FROM payments p JOIN documents d ON d.id = p.document_id
  WHERE p.id = NEW.payment_id AND d.status NOT IN ('draft')
)
BEGIN
  SELECT RAISE(ABORT, 'immutable_payment');
END;

CREATE TRIGGER payment_details_frozen_update BEFORE UPDATE ON payment_details
WHEN EXISTS (
  SELECT 1 FROM payments p JOIN documents d ON d.id = p.document_id
  WHERE p.id IN (OLD.payment_id, NEW.payment_id) AND d.status NOT IN ('draft')
)
BEGIN
  SELECT RAISE(ABORT, 'immutable_payment');
END;

CREATE TRIGGER payment_details_frozen_delete BEFORE DELETE ON payment_details
WHEN EXISTS (
  SELECT 1 FROM payments p JOIN documents d ON d.id = p.document_id
  WHERE p.id = OLD.payment_id AND d.status NOT IN ('draft')
)
BEGIN
  SELECT RAISE(ABORT, 'immutable_payment');
END;

CREATE TRIGGER payment_details_bump_insert AFTER INSERT ON payment_details
BEGIN
  UPDATE documents SET version = version + 1
  WHERE status = 'draft' AND id = (SELECT document_id FROM payments WHERE id = NEW.payment_id);
END;

CREATE TRIGGER payment_details_bump_update AFTER UPDATE ON payment_details
BEGIN
  UPDATE documents SET version = version + 1
  WHERE status = 'draft' AND id = (SELECT document_id FROM payments WHERE id = NEW.payment_id);
END;

-- ---------------------------------------------------------------------------
-- Timeline: create, finalize, send, payments, conversions, credits, cancel.
-- Append-only. Events of a draft go away with the draft.
-- ---------------------------------------------------------------------------
CREATE TABLE document_events (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents (id),
  kind TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  user_id INTEGER,
  user_email TEXT,
  details TEXT
);
CREATE INDEX document_events_document ON document_events (document_id, at);

CREATE TRIGGER document_events_no_update BEFORE UPDATE ON document_events
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

CREATE TRIGGER document_events_no_delete BEFORE DELETE ON document_events
WHEN EXISTS (SELECT 1 FROM documents WHERE id = OLD.document_id AND status NOT IN ('draft'))
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

-- ---------------------------------------------------------------------------
-- Date rule: no final document dated before the last final document of the same series.
-- Cancelled documents keep their place in the series and count.
-- ---------------------------------------------------------------------------
CREATE TRIGGER finalizations_date_order BEFORE INSERT ON finalizations
BEGIN
  SELECT RAISE(ABORT, 'date_before_last_in_series')
  WHERE (SELECT date FROM documents WHERE id = NEW.document_id) < (
    SELECT MAX(d.date) FROM finalizations f JOIN documents d ON d.id = f.document_id
    WHERE f.series_id = NEW.series_id
  );
END;

-- ---------------------------------------------------------------------------
-- Payments against a demand never exceed its total. Credits never exceed the credited document.
-- Checked inside the finalize batch, so two receipts finalized at once cannot overpay.
-- Links to cancelled targets do not count. A cancelled source takes no new payment or credit.
-- ---------------------------------------------------------------------------
CREATE TRIGGER document_links_payment_cap BEFORE INSERT ON document_links
WHEN NEW.kind = 'payment'
BEGIN
  SELECT RAISE(ABORT, 'source_not_open')
  WHERE (SELECT status FROM documents WHERE id = NEW.source_id) IS NOT 'final';
  SELECT RAISE(ABORT, 'payment_exceeds_balance')
  WHERE NEW.amount_minor IS NULL
    OR NEW.amount_minor <= 0
    OR NEW.currency IS NOT (SELECT currency FROM documents WHERE id = NEW.source_id)
    OR NEW.amount_minor + COALESCE((
      SELECT SUM(l.amount_minor) FROM document_links l JOIN documents t ON t.id = l.target_id
      WHERE l.source_id = NEW.source_id AND l.kind = 'payment' AND t.status <> 'cancelled'
    ), 0) > (SELECT total_minor FROM documents WHERE id = NEW.source_id);
END;

CREATE TRIGGER document_links_credit_cap BEFORE INSERT ON document_links
WHEN NEW.kind = 'credit'
BEGIN
  SELECT RAISE(ABORT, 'source_not_open')
  WHERE (SELECT status FROM documents WHERE id = NEW.source_id) IS NOT 'final';
  SELECT RAISE(ABORT, 'credit_exceeds_document')
  WHERE NEW.amount_minor IS NULL
    OR NEW.amount_minor <= 0
    OR NEW.currency IS NOT (SELECT currency FROM documents WHERE id = NEW.source_id)
    OR NEW.amount_minor + COALESCE((
      SELECT SUM(l.amount_minor) FROM document_links l JOIN documents t ON t.id = l.target_id
      WHERE l.source_id = NEW.source_id AND l.kind = 'credit' AND t.status <> 'cancelled'
    ), 0) > (SELECT total_minor FROM documents WHERE id = NEW.source_id);
END;

-- ---------------------------------------------------------------------------
-- Settings owned by the documents module. Values are strings.
-- ---------------------------------------------------------------------------
INSERT INTO settings (key, value) VALUES
  ('documents.backdate_days', '3'),
  ('documents.qt_pr_editable_until_converted', 'true');
