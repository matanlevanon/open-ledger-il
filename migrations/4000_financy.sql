-- R40: the Financy connection (bank and card data, read only). docs: runs/R40-financy-connection.md.
-- The client secret is AES-GCM at rest with the ITA_TOKEN_KEY key and additional data
-- "financy:<business_id>", so it never decrypts as an ITA token. The Financy access token is never
-- stored: each Worker isolate keeps it in memory. No owner name, national id or full account number
-- is stored anywhere.

CREATE TABLE financy_connection (
  business_id INTEGER PRIMARY KEY,
  client_id TEXT NOT NULL,
  -- v1.<iv>.<ciphertext>. Null once disconnected.
  client_secret_enc TEXT,
  secret_last4 TEXT,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('connected', 'error', 'disconnected')),
  last_error TEXT,
  last_sync_at TEXT,
  -- JSON: { accounts, transactions, new, matched }
  last_sync_result TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE bank_accounts (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL,
  financy_id TEXT NOT NULL,
  account_type TEXT NOT NULL,
  name TEXT,
  provider_id TEXT,
  -- The last 4 digits only.
  masked_number TEXT,
  currency TEXT,
  balance_minor INTEGER,
  balance_type TEXT,
  available_minor INTEGER,
  credit_limit_minor INTEGER,
  card_due_date TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (business_id, financy_id)
);

CREATE TABLE bank_transactions (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL,
  financy_id TEXT NOT NULL,
  account_financy_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('BANK', 'CARD')),
  -- The day the transaction happened (transactionDate, else bookingDate).
  booked_on TEXT NOT NULL,
  value_on TEXT,
  -- Signed: negative is money out.
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  original_amount_minor INTEGER,
  original_currency TEXT,
  -- 200 characters at most.
  description TEXT,
  merchant TEXT,
  category_main TEXT,
  category_sub TEXT,
  installment_number INTEGER,
  installment_total INTEGER,
  match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched', 'matched', 'ignored', 'added')),
  matched_expense_id INTEGER REFERENCES expenses (id),
  -- A suggested payment request or transaction invoice. Nothing is recorded until a person confirms.
  matched_document_id INTEGER REFERENCES documents (id),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (business_id, financy_id)
);
CREATE INDEX bank_transactions_by_date ON bank_transactions (business_id, booked_on);
CREATE INDEX bank_transactions_by_expense ON bank_transactions (matched_expense_id);
