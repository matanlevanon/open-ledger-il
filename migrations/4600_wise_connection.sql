-- R49: the Wise Business connection (money in and out on the business's Wise balances, read only).
-- The API token is AES-GCM at rest with the ITA_TOKEN_KEY key and additional data
-- "wise:<business_id>", so it never decrypts as an ITA token, a Financy secret or another business's
-- token. Wise balances and their rows go into bank_accounts and bank_transactions, with ids that
-- start with "wise:", so Bank activity, matching and the bank dashboard read them like any account.

CREATE TABLE wise_connection (
  business_id INTEGER PRIMARY KEY REFERENCES businesses (id),
  -- v1.<iv>.<ciphertext>. Null once disconnected.
  token_enc TEXT,
  token_last4 TEXT,
  -- The Wise Business profile the token reads. Never a personal profile.
  profile_id INTEGER NOT NULL,
  profile_name TEXT,
  -- The unguessable last part of the webhook address, /v1/hooks/wise/<hook_id>.
  hook_id TEXT NOT NULL UNIQUE,
  -- Set when the Ledger created the webhook through the Wise API. Null: made by hand in Wise, or not yet.
  subscription_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('connected', 'error', 'disconnected')),
  last_error TEXT,
  last_sync_at TEXT,
  -- JSON: { accounts, transactions, new, matched }
  last_sync_result TEXT,
  -- The last signed event Wise delivered, a test event included.
  last_event_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
