-- Copies of outgoing document emails. clients.cc_emails: addresses copied on every document sent
-- to this client, comma separated. send_log.cc_addresses: who was copied on each send. The
-- account-wide list lives in settings under sending.cc_emails.
ALTER TABLE clients ADD COLUMN cc_emails TEXT;
ALTER TABLE send_log ADD COLUMN cc_addresses TEXT;
