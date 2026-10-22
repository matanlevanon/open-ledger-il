-- R45: an optional group on a client, a label for sorting the client list (for example "Open Ledger" for
-- the buyers of the Open Ledger shop). It changes nothing on documents. NULL means no group.
ALTER TABLE clients ADD COLUMN client_group TEXT;
CREATE INDEX IF NOT EXISTS idx_clients_group ON clients (business_id, client_group);

-- Clients the Open Ledger shop made before groups existed carry this note. Put them in the group once.
UPDATE clients SET client_group = 'Open Ledger' WHERE client_group IS NULL AND notes LIKE 'Open Ledger IL shop, order %';
