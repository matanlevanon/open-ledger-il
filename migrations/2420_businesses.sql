-- R24 Phase B: more than one business in one Ledger. A business is a legal entity with its own
-- tax id. Business 1 is today's data and nothing about it changes: every row keeps its values,
-- every new business column defaults to 1.
--
-- business_profile becomes a view of business 1 with the same columns in the same order, so a
-- reader that still names it sees exactly what it saw before. Writes through the view reach
-- businesses row 1 by INSTEAD OF triggers. Code reads and writes businesses by id.

CREATE TABLE businesses (
  id INTEGER PRIMARY KEY,
  name_en TEXT NOT NULL DEFAULT '',
  name_he TEXT NOT NULL DEFAULT '',
  address_en TEXT,
  address_he TEXT,
  email TEXT,
  phone TEXT,
  website TEXT,
  bank_details TEXT,
  logo_r2_key TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  payment_link_stripe TEXT,
  payment_link_paypal TEXT,
  payment_instructions TEXT,
  payment_method_ids TEXT,
  tagline_en TEXT,
  tagline_he TEXT,
  tax_id TEXT,
  signature_r2_key TEXT,
  entity_type TEXT NOT NULL DEFAULT 'osek_patur' CHECK (entity_type IN ('osek_patur', 'osek_murshe', 'company')),
  vat_reporting TEXT NOT NULL DEFAULT 'bimonthly' CHECK (vat_reporting IN ('monthly', 'bimonthly')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO businesses (
  id, name_en, name_he, address_en, address_he, email, phone, website, bank_details, logo_r2_key, updated_at,
  payment_link_stripe, payment_link_paypal, payment_instructions, payment_method_ids, tagline_en, tagline_he,
  tax_id, signature_r2_key, entity_type, vat_reporting
)
SELECT
  id, name_en, name_he, address_en, address_he, email, phone, website, bank_details, logo_r2_key, updated_at,
  payment_link_stripe, payment_link_paypal, payment_instructions, payment_method_ids, tagline_en, tagline_he,
  tax_id, signature_r2_key, entity_type, vat_reporting
FROM business_profile;

DROP TRIGGER business_profile_entity_type_lock;
DROP TRIGGER business_profile_insert_lock;
DROP TRIGGER business_profile_no_delete;
DROP TABLE business_profile;

CREATE VIEW business_profile AS
SELECT
  id, name_en, name_he, address_en, address_he, email, phone, website, bank_details, logo_r2_key, updated_at,
  payment_link_stripe, payment_link_paypal, payment_instructions, payment_method_ids, tagline_en, tagline_he,
  tax_id, signature_r2_key, entity_type, vat_reporting
FROM businesses WHERE id = 1;

CREATE TRIGGER business_profile_view_update INSTEAD OF UPDATE ON business_profile
BEGIN
  UPDATE businesses SET
    name_en = NEW.name_en, name_he = NEW.name_he, address_en = NEW.address_en, address_he = NEW.address_he,
    email = NEW.email, phone = NEW.phone, website = NEW.website, bank_details = NEW.bank_details,
    logo_r2_key = NEW.logo_r2_key, updated_at = NEW.updated_at, payment_link_stripe = NEW.payment_link_stripe,
    payment_link_paypal = NEW.payment_link_paypal, payment_instructions = NEW.payment_instructions,
    payment_method_ids = NEW.payment_method_ids, tagline_en = NEW.tagline_en, tagline_he = NEW.tagline_he,
    tax_id = NEW.tax_id, signature_r2_key = NEW.signature_r2_key, entity_type = NEW.entity_type,
    vat_reporting = NEW.vat_reporting
  WHERE id = OLD.id;
END;

CREATE TRIGGER business_profile_view_insert INSTEAD OF INSERT ON business_profile
BEGIN
  INSERT INTO businesses (id, name_en, name_he, entity_type)
  VALUES (NEW.id, COALESCE(NEW.name_en, ''), COALESCE(NEW.name_he, ''), COALESCE(NEW.entity_type, 'osek_patur'));
END;

CREATE TRIGGER business_profile_view_delete INSTEAD OF DELETE ON business_profile
BEGIN
  DELETE FROM businesses WHERE id = OLD.id;
END;

-- legal_modes per business: effective_from is unique within a business only. SQLite cannot change
-- a table constraint in place, so the table is rebuilt with every column and row as they were.
-- No table references it. The 2410 lock triggers are recreated per business below.
CREATE TABLE legal_modes_new (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL DEFAULT 1 REFERENCES businesses (id),
  mode TEXT NOT NULL CHECK (mode IN ('patur', 'murshe')),
  effective_from TEXT NOT NULL,
  confirmed_at TEXT,
  confirmed_by INTEGER REFERENCES users (id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (business_id, effective_from)
);
INSERT INTO legal_modes_new (id, business_id, mode, effective_from, confirmed_at, confirmed_by, note, created_at)
SELECT id, 1, mode, effective_from, confirmed_at, confirmed_by, note, created_at FROM legal_modes;
DROP TRIGGER legal_modes_no_update;
DROP TRIGGER legal_modes_no_delete;
DROP TRIGGER legal_modes_no_patur_after_murshe;
DROP TABLE legal_modes;
ALTER TABLE legal_modes_new RENAME TO legal_modes;

CREATE TRIGGER legal_modes_no_update BEFORE UPDATE ON legal_modes
BEGIN
  SELECT RAISE(ABORT, 'legal_mode_locked');
END;

CREATE TRIGGER legal_modes_no_delete BEFORE DELETE ON legal_modes
BEGIN
  SELECT RAISE(ABORT, 'legal_mode_locked');
END;

CREATE TRIGGER legal_modes_no_patur_after_murshe BEFORE INSERT ON legal_modes
WHEN NEW.mode = 'patur' AND EXISTS (SELECT 1 FROM legal_modes WHERE mode = 'murshe' AND business_id = NEW.business_id)
BEGIN
  SELECT RAISE(ABORT, 'legal_mode_locked');
END;
