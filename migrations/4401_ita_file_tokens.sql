-- R47: the unified file services take a token from their own OAuth provider (dailytoken), with
-- their own scopes. It is kept apart from the invoice login, per business and environment.
CREATE TABLE ita_file_tokens (
  business_id INTEGER NOT NULL DEFAULT 1 REFERENCES businesses (id),
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  -- Empty when the ITA sends no refresh token: the login then lasts as long as the access token.
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

-- Which login a sign-in started for: the invoice login or the unified file login.
ALTER TABLE ita_oauth_states ADD COLUMN purpose TEXT NOT NULL DEFAULT 'invoices';
