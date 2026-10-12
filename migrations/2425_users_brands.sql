-- R24 Phase B (R23 tasks 4 and 6): roles per business, and brands.

-- A person's access to one business. Roles: owner (everything), assistant (issue and send,
-- clients and expenses, no Settings, numbering, users, legal mode or ITA), accountant (read-only
-- with feature switches, as before). users.role stays for history and is no longer read.
CREATE TABLE user_businesses (
  user_id INTEGER NOT NULL REFERENCES users (id),
  business_id INTEGER NOT NULL REFERENCES businesses (id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'assistant', 'accountant')),
  granted_by INTEGER REFERENCES users (id),
  granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ends_at TEXT,
  PRIMARY KEY (user_id, business_id)
);
CREATE INDEX user_businesses_business ON user_businesses (business_id, role);

-- Every existing user keeps exactly the access they had, on business 1.
INSERT INTO user_businesses (user_id, business_id, role, ends_at)
SELECT id, 1, role, access_ends_on FROM users;

-- A brand is a name, tagline, logo and contact block printed on documents of one business.
-- The tax id, legal name and legal type always come from the business. Empty fields fall back to it.
CREATE TABLE brands (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses (id),
  name_en TEXT NOT NULL DEFAULT '',
  name_he TEXT NOT NULL DEFAULT '',
  tagline_en TEXT,
  tagline_he TEXT,
  logo_r2_key TEXT,
  email TEXT,
  phone TEXT,
  website TEXT,
  address_en TEXT,
  address_he TEXT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX brands_one_default ON brands (business_id) WHERE is_default = 1;

-- A brand field left empty prints the business's own value. Business 1's default brand starts
-- empty, so its documents print today's business profile and logo, and Settings > Business keeps
-- driving them until the owner fills in the brand.
INSERT INTO brands (business_id, is_default) SELECT id, 1 FROM businesses WHERE id = 1;

-- A brand never moves to another business, and the default brand stays.
CREATE TRIGGER brands_business_fixed BEFORE UPDATE OF business_id ON brands
WHEN NEW.business_id IS NOT OLD.business_id
BEGIN
  SELECT RAISE(ABORT, 'business_mismatch');
END;

CREATE TRIGGER brands_no_delete BEFORE DELETE ON brands
BEGIN
  SELECT RAISE(ABORT, 'brand_in_use');
END;

-- ITA tokens per business and environment. Rebuilt: the key was the environment alone.
CREATE TABLE ita_tokens_new (
  business_id INTEGER NOT NULL DEFAULT 1 REFERENCES businesses (id),
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  refresh_token_enc TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  access_token_enc TEXT,
  access_expires_at TEXT,
  login_at TEXT NOT NULL,
  relogin_due_at TEXT NOT NULL,
  last_refresh_at TEXT,
  rotation INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reconnect_required')),
  status_reason TEXT,
  reminder_sent_at TEXT,
  connected_by INTEGER REFERENCES users (id),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (business_id, environment)
);
INSERT INTO ita_tokens_new (
  business_id, environment, refresh_token_enc, refresh_expires_at, access_token_enc, access_expires_at, login_at,
  relogin_due_at, last_refresh_at, rotation, status, status_reason, reminder_sent_at, connected_by, updated_at
)
SELECT
  1, environment, refresh_token_enc, refresh_expires_at, access_token_enc, access_expires_at, login_at,
  relogin_due_at, last_refresh_at, rotation, status, status_reason, reminder_sent_at, connected_by, updated_at
FROM ita_tokens;
DROP TABLE ita_tokens;
ALTER TABLE ita_tokens_new RENAME TO ita_tokens;

-- One accountant pack per business per month. Rebuilt: period was unique across the Ledger.
CREATE TABLE accountant_packs_new (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL DEFAULT 1 REFERENCES businesses (id),
  period TEXT NOT NULL,
  pdf_key TEXT NOT NULL,
  xlsx_key TEXT NOT NULL,
  zip_key TEXT NOT NULL,
  expense_file_count INTEGER NOT NULL DEFAULT 0,
  income_total_ils_minor INTEGER NOT NULL DEFAULT 0,
  expense_total_ils_minor INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  emailed_at TEXT,
  email_error TEXT,
  UNIQUE (business_id, period)
);
INSERT INTO accountant_packs_new (
  id, business_id, period, pdf_key, xlsx_key, zip_key, expense_file_count, income_total_ils_minor,
  expense_total_ils_minor, generated_at, emailed_at, email_error
)
SELECT
  id, 1, period, pdf_key, xlsx_key, zip_key, expense_file_count, income_total_ils_minor,
  expense_total_ils_minor, generated_at, emailed_at, email_error
FROM accountant_packs;
DROP TABLE accountant_packs;
ALTER TABLE accountant_packs_new RENAME TO accountant_packs;
