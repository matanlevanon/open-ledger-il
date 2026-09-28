-- R06 sending. Module `sending`. client_consents (R00), documents.due_date (R00) and
-- document_events (R01) already exist; this migration only adds the send log.

-- Every attempt to hand a document, or a consent request, to a client. Append-only, like
-- document_events and audit_log: a send either happened or it did not, so nothing here is
-- ever updated or deleted, only inserted.
CREATE TABLE send_log (
  id INTEGER PRIMARY KEY,
  document_id INTEGER REFERENCES documents (id),
  client_id INTEGER REFERENCES clients (id),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp', 'consent_request', 'reminder_before', 'reminder_after')),
  to_address TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'blocked')),
  reason TEXT,
  provider_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX send_log_document ON send_log (document_id, created_at);
CREATE INDEX send_log_client ON send_log (client_id, created_at);

CREATE TRIGGER send_log_append_only_update BEFORE UPDATE ON send_log
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;

CREATE TRIGGER send_log_append_only_delete BEFORE DELETE ON send_log
BEGIN
  SELECT RAISE(ABORT, 'append_only');
END;
