-- R48 task 2: a tax id is unique across the businesses of one Ledger, in every edition.
-- The rule lives in the service (src/modules/businesses/service.ts, assertTaxIdFree: digits only,
-- 409 tax_id_taken), not in a unique index. SQLite cannot skip a CREATE UNIQUE INDEX that existing
-- rows break, so a Ledger that already holds a duplicate would fail to migrate. The public demo also
-- copies its sample businesses with the same tax id for every visitor, by design.
-- This index only makes the lookup fast.
CREATE INDEX businesses_tax_id ON businesses (tax_id) WHERE tax_id IS NOT NULL AND tax_id != '';
