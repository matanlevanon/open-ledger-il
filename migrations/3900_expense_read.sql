-- R39: why an expense was or was not read automatically, so an unread one can be read again.
-- read_status: 'read' (the reader filled it), 'failed' (the reader could not), 'manual' (typed by a
-- person or sent through MCP add_expense). Null for rows older than this migration.
ALTER TABLE expenses ADD COLUMN read_status TEXT CHECK (read_status IN ('read', 'failed', 'manual'));
ALTER TABLE expenses ADD COLUMN read_attempts INTEGER NOT NULL DEFAULT 0;
-- The reader's reason on the last failure, 500 characters at most.
ALTER TABLE expenses ADD COLUMN read_error TEXT;
ALTER TABLE expenses ADD COLUMN read_at TEXT;

-- Older unread expenses carry the reason in their note. They become failed, read once.
UPDATE expenses
   SET read_status = 'failed',
       read_attempts = 1,
       read_error = substr(trim(substr(notes, instr(notes, 'Not read automatically:') + length('Not read automatically:'))), 1, 500)
 WHERE notes LIKE '%Not read automatically:%';

-- The daily retry looks for unread expenses waiting for review.
CREATE INDEX expenses_read_retry ON expenses (business_id, status, read_status, created_at);
