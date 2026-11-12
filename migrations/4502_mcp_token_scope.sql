-- R48 task 1: an MCP token belongs to one business, or to every business when business_id is
-- null. Existing tokens stay null, so nothing breaks. In the firm edition a business owner makes
-- tokens for their own business only. Null-scope tokens are for Ledger admins.
ALTER TABLE mcp_tokens ADD COLUMN business_id INTEGER REFERENCES businesses (id);

-- At most one active token per scope. Was one active token for the whole Ledger.
DROP INDEX mcp_tokens_one_active;
CREATE UNIQUE INDEX mcp_tokens_one_active ON mcp_tokens (COALESCE(business_id, 0)) WHERE revoked_at IS NULL;
