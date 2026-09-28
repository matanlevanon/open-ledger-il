-- R00 seed. Legal values live here as effective-dated rows, never in code (CLAUDE.md rule 4).

INSERT INTO business_profile (id, name_en, name_he) VALUES (1, '', '');

INSERT INTO legal_modes (mode, effective_from, note)
VALUES ('patur', '2020-01-01', 'עוסק פטור until the confirmed switch');

INSERT INTO vat_rates (rate_bp, effective_from, note)
VALUES (1800, '2025-01-01', 'VAT 18% since 1 Jan 2025');

INSERT INTO thresholds (key, amount_minor, currency, effective_from, note)
VALUES ('allocation', 500000, 'ILS', '2026-06-01', 'ITA allocation number above ILS 5,000 before VAT');

INSERT INTO ceilings (year, amount_minor, currency, note)
VALUES (2026, 12283300, 'ILS', 'עוסק פטור ceiling 2026');

-- פטור-mode series. Starting numbers stay settable until the first document is finalized.
INSERT INTO series (id, doc_type, name_en, name_he, legal_mode) VALUES
  ('QT', 'QT', 'Quote', 'הצעת מחיר', NULL),
  ('PR', 'PR', 'Payment request', 'דרישת תשלום', NULL),
  ('300', '300', 'Transaction invoice', 'חשבון עסקה', 'patur'),
  ('400', '400', 'Receipt', 'קבלה', 'patur'),
  ('405', '405', 'Credit receipt', 'קבלת זיכוי', 'patur');
