-- R17 task 4: proforma invoice (PF). Behaves like a payment request (kind = 'demand', not a
-- bookkeeping record, never a tax document, no allocation number), available in both legal
-- modes, so its series never needs a patur/murshe split the way 300/400/405's do.
INSERT INTO document_types (code, name_en, name_he, kind, modes, bookkeeping, credit_type, sort_order, enabled) VALUES
  ('PF', 'Pro Forma Invoice', 'חשבונית פרופורמה', 'demand', 'both', 0, NULL, 25, 1);

INSERT INTO series (id, doc_type, name_en, name_he, legal_mode) VALUES
  ('PF', 'PF', 'Pro Forma Invoice', 'חשבונית פרופורמה', NULL);

-- Unified-file mapping (R13 exports): non-reportable, same as QT and PR.
INSERT INTO unified_file_doc_type_codes (internal_code, note) VALUES
  ('PF', 'Pro forma invoice: not a bookkeeping record (document_types.bookkeeping = 0), never a tax document. Likely excluded; confirm against the spec.');
