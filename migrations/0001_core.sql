-- R00 core schema. Owned by R00. Other runs add tables in their own migration range.
-- Money columns end in _minor and hold integers in minor units (agorot, cents).
-- Exchange rates are TEXT with 6 decimals. Dates are TEXT YYYY-MM-DD. Timestamps are TEXT ISO 8601 UTC.

-- Business details in both languages. One row. The owner ID number (ת"ז) is the
-- OWNER_TAX_ID secret and never stored here (CLAUDE.md rule 5).
CREATE TABLE business_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name_en TEXT NOT NULL DEFAULT '',
  name_he TEXT NOT NULL DEFAULT '',
  address_en TEXT,
  address_he TEXT,
  email TEXT,
  phone TEXT,
  website TEXT,
  bank_details TEXT,
  logo_r2_key TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'accountant')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  access_ends_on TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Per-feature switches for accountants. Owners pass every feature check.
CREATE TABLE user_features (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, feature)
);

-- Effective-dated legal mode. The row with the latest effective_from on or before a date applies.
CREATE TABLE legal_modes (
  id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('patur', 'murshe')),
  effective_from TEXT NOT NULL UNIQUE,
  confirmed_at TEXT,
  confirmed_by INTEGER REFERENCES users (id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- VAT rate in basis points (1800 = 18%). Never hard-coded (CLAUDE.md rule 4).
CREATE TABLE vat_rates (
  id INTEGER PRIMARY KEY,
  rate_bp INTEGER NOT NULL CHECK (rate_bp >= 0 AND rate_bp <= 10000),
  effective_from TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Named money thresholds, e.g. 'allocation' (ITA allocation number above this, before VAT).
CREATE TABLE thresholds (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'ILS',
  effective_from TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (key, effective_from)
);

-- עוסק פטור annual turnover ceiling, one row per calendar year.
CREATE TABLE ceilings (
  id INTEGER PRIMARY KEY,
  year INTEGER NOT NULL UNIQUE CHECK (year BETWEEN 2000 AND 2100),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'ILS',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One continuous number series per document type (CLAUDE.md rule 2).
-- next_number moves only through the finalize transaction (see finalizations).
-- start_number is settable until the first number is issued.
CREATE TABLE series (
  id TEXT PRIMARY KEY,
  doc_type TEXT NOT NULL,
  name_en TEXT NOT NULL,
  name_he TEXT,
  legal_mode TEXT CHECK (legal_mode IN ('patur', 'murshe')),
  start_number INTEGER NOT NULL DEFAULT 1 CHECK (start_number >= 1),
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  started_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX series_one_open_per_type ON series (doc_type) WHERE closed_at IS NULL;

CREATE TABLE clients (
  id INTEGER PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_he TEXT,
  company_id TEXT,
  vat_number TEXT,
  country TEXT NOT NULL DEFAULT 'IL',
  foreign_resident INTEGER NOT NULL DEFAULT 0 CHECK (foreign_resident IN (0, 1)),
  currency TEXT NOT NULL DEFAULT 'ILS',
  client_copy_lang TEXT NOT NULL DEFAULT 'en' CHECK (client_copy_lang IN ('en', 'bilingual')),
  email TEXT,
  phone TEXT,
  address_en TEXT,
  address_he TEXT,
  notes TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Consent to receive digital documents (instruction 18ב). Revocation adds a row.
CREATE TABLE client_consents (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients (id),
  kind TEXT NOT NULL DEFAULT 'digital_documents',
  status TEXT NOT NULL CHECK (status IN ('requested', 'granted', 'revoked')),
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  method TEXT,
  ip TEXT,
  user_agent TEXT,
  evidence TEXT
);
CREATE INDEX client_consents_client ON client_consents (client_id, at);

CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_he TEXT,
  description_en TEXT,
  description_he TEXT,
  unit_price_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ILS',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Every income document. `version` goes up on every draft change, so finalize can tell
-- whether the draft it hashed is still the draft it freezes. Numbers, hashes and status 'final' come only from the finalize
-- transaction. Rows in status final or cancelled are frozen by triggers in 0002_integrity.sql.
CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  series_id TEXT NOT NULL REFERENCES series (id),
  number INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'awaiting_allocation', 'allocation_pending', 'allocation_refused', 'final', 'cancelled'
  )),
  legal_mode TEXT CHECK (legal_mode IN ('patur', 'murshe')),
  client_id INTEGER REFERENCES clients (id),
  date TEXT NOT NULL,
  issuance_date TEXT,
  due_date TEXT,
  currency TEXT NOT NULL DEFAULT 'ILS',
  fx_rate TEXT,
  fx_rate_date TEXT,
  fx_source TEXT,
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  vat_rate_bp INTEGER,
  vat_amount_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  total_ils_minor INTEGER,
  allocation_number TEXT,
  lang_variant TEXT NOT NULL DEFAULT 'en' CHECK (lang_variant IN ('en', 'bilingual')),
  notes TEXT,
  hash TEXT,
  prev_hash TEXT,
  pdf_hashes TEXT,
  finalized_at TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  created_by INTEGER REFERENCES users (id),
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX documents_series_number ON documents (series_id, number) WHERE number IS NOT NULL;
CREATE INDEX documents_client ON documents (client_id, date);
CREATE INDEX documents_status ON documents (status, type);

CREATE TABLE document_lines (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents (id),
  position INTEGER NOT NULL,
  item_id INTEGER REFERENCES items (id),
  description_en TEXT NOT NULL,
  description_he TEXT,
  quantity_milli INTEGER NOT NULL DEFAULT 1000,
  unit_price_minor INTEGER NOT NULL,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  line_total_minor INTEGER NOT NULL,
  UNIQUE (document_id, position)
);

-- Money received, attached to the receipt that records it.
CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents (id),
  method TEXT NOT NULL CHECK (method IN ('bank_transfer', 'card', 'cheque', 'cash', 'other')),
  paid_on TEXT NOT NULL,
  reference TEXT,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  fx_rate TEXT,
  fx_rate_date TEXT,
  fx_source TEXT,
  amount_ils_minor INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX payments_document ON payments (document_id);

-- Source to target relations: quote to PR, PR to receipt, document to credit.
CREATE TABLE document_links (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES documents (id),
  target_id INTEGER NOT NULL REFERENCES documents (id),
  kind TEXT NOT NULL CHECK (kind IN ('converted', 'payment', 'credit', 'carried_rate')),
  amount_minor INTEGER,
  currency TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source_id, target_id, kind)
);
CREATE INDEX document_links_target ON document_links (target_id);

-- Bank of Israel representative rates and manual rates. Filled by R04.
CREATE TABLE fx_rates (
  currency TEXT NOT NULL,
  rate_date TEXT NOT NULL,
  rate TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'boi',
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (currency, rate_date, source)
);

-- Append-only log of who did what. Every accountant request lands here (CLAUDE.md rule 6).
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  user_id INTEGER,
  user_email TEXT,
  role TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX audit_log_entity ON audit_log (entity, entity_id);
CREATE INDEX audit_log_user ON audit_log (user_id, at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The finalize transaction. One row per final document, in finalize order.
-- Triggers in 0002_integrity.sql check the series, the number and the chain head on insert,
-- then advance the series. This table is the single source of document numbers.
CREATE TABLE finalizations (
  seq INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL UNIQUE REFERENCES documents (id),
  series_id TEXT NOT NULL REFERENCES series (id),
  number INTEGER NOT NULL,
  doc_version INTEGER NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  finalized_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (series_id, number)
);
