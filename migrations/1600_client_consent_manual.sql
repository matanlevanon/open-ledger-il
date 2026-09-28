-- R16 task 1: manual consent capture from the client create and edit forms.
-- Existing client_consents rows (kind = 'digital_documents') already record method,
-- ip, user_agent and evidence. Manual entries need the chosen source and an optional note.
ALTER TABLE client_consents ADD COLUMN source TEXT;
ALTER TABLE client_consents ADD COLUMN reference_note TEXT;
