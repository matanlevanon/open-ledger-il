-- Blind copies of outgoing document emails: the account list in Settings > Email goes out as BCC.
-- send_log.bcc_addresses records who was blind-copied on each send.
ALTER TABLE send_log ADD COLUMN bcc_addresses TEXT;
