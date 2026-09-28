-- R17 task 5: services catalog. Reuses the existing `items` table (created in 0001_core.sql,
-- never wired into the app until now: document_lines.item_id already references it) rather than
-- a new table, adding the columns a service needs beyond a plain price list.
ALTER TABLE items ADD COLUMN default_quantity_milli INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE items ADD COLUMN unit TEXT NOT NULL DEFAULT 'item' CHECK (unit IN ('hour', 'day', 'month', 'project', 'item'));
-- Informational only for now: VAT on a document is computed at the document level from the legal
-- mode and the VAT rate in force (src/modules/documents/service.ts `compute()`), never per line.
-- `vat_treatment` documents each service's intended treatment for when a later run adds per-line
-- VAT overrides; it does not yet change any calculation.
ALTER TABLE items ADD COLUMN vat_treatment TEXT NOT NULL DEFAULT 'standard' CHECK (vat_treatment IN ('standard', 'exempt', 'zero_rated'));
ALTER TABLE items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
