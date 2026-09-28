-- R18 task 10: document names, and 300 becomes the single pro forma / transaction invoice.
--
-- PF (R17 task 4) and 300 (R01, "Transaction invoice") were the same document in practice.
-- Rather than keep two types, 300 keeps its own series and numbering (it is the older, already-
-- wired-everywhere type) and takes on PF's name and PF's non-bookkeeping treatment; PF is
-- disabled for new documents (enabled = 0) but never touched otherwise, so an already-finalized
-- PF document stays exactly as it is: same number, same series, same name ("Pro Forma Invoice" /
-- "חשבון עסקה", unchanged since migration 1800), fully readable forever (CLAUDE.md rule 1). PF's
-- own row is left enabled in `modes`/`kind`/etc: `enabled = 0` alone is what createDraft's
-- `type.enabled !== 1` check reads to refuse a *new* PF, and it does not affect reading, printing
-- or converting an existing one.
UPDATE document_types SET enabled = 0 WHERE code = 'PF';

-- 300 takes PF's behaviour: not a bookkeeping record (excluded from the unified file export,
-- whose filter is document_types.bookkeeping = 1 with "no change needed" there by design; see
-- src/modules/exports/unified-file/build.ts). name_he is already חשבון עסקה (migration 1800).
UPDATE document_types SET name_en = 'Pro Forma Invoice', bookkeeping = 0 WHERE code = '300';
UPDATE series SET name_en = 'Pro Forma Invoice' WHERE id = '300';

-- Document name corrections (task 10's own list). 300, done above.
UPDATE document_types SET name_en = 'Payment Request' WHERE code = 'PR';
UPDATE series SET name_en = 'Payment Request' WHERE id = 'PR';

UPDATE document_types SET name_en = 'Credit', name_he = 'מסמך זיכוי' WHERE code = '405';
UPDATE series SET name_en = 'Credit', name_he = 'מסמך זיכוי' WHERE id = '405';

-- 305/320/330 have no series row yet (R11's switchToMurshe opens one at switch time, copying
-- name_en/name_he from document_types as it does then, src/modules/legal-mode/service.ts); the
-- UPDATE ... SET on `series` below is a no-op today and only guards a switch that already ran in
-- some other environment before this migration.
UPDATE document_types SET name_en = 'Invoice' WHERE code = '305';
UPDATE series SET name_en = 'Invoice' WHERE id = '305';

UPDATE document_types SET name_en = 'Invoice / Receipt', name_he = 'חשבונית מס קבלה' WHERE code = '320';
UPDATE series SET name_en = 'Invoice / Receipt', name_he = 'חשבונית מס קבלה' WHERE id = '320';

UPDATE document_types SET name_en = 'Credit Invoice', name_he = 'חשבונית מס זיכוי' WHERE code = '330';
UPDATE series SET name_en = 'Credit Invoice', name_he = 'חשבונית מס זיכוי' WHERE id = '330';

-- The unified-file reference table's own note for 300, updated to match: it is no longer a
-- bookkeeping record (the exporter's actual filter, document_types.bookkeeping, already excludes
-- it with no code change needed).
UPDATE unified_file_doc_type_codes
SET note = 'Pro forma invoice (merged with PF, R18 task 10): not a bookkeeping record (document_types.bookkeeping = 0), never a tax document. Likely excluded; confirm against the spec.'
WHERE internal_code = '300';
