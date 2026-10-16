-- R34: the MCP token the Ledger keeps itself, made in Settings > MCP.
-- The Worker secret MCP_TOKEN is the starting token from the installer. A Worker cannot change its
-- own secrets, so a token made in Settings lives here. Only its SHA-256 is stored, never the token.
-- One token serves every business. Once a row is active, MCP_TOKEN no longer works.
CREATE TABLE mcp_tokens (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  last4 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  last_used_at TEXT,
  CHECK (length(token_hash) = 64),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

-- At most one active token. Every active row indexes the same value, so a second one is refused.
CREATE UNIQUE INDEX mcp_tokens_one_active ON mcp_tokens ((revoked_at IS NULL)) WHERE revoked_at IS NULL;

-- MCP on or off for the whole Ledger is the setting `mcp.enabled`. It has no row until the owner
-- turns MCP off, and absent reads as on (src/modules/mcp/tokens.ts). Migrations leave settings as
-- they are (test/modules/legal-mode/business-one-fixture.test.ts).
