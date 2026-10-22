-- R46: a buyer from the Open Ledger shop buys once, so the client is not active after the sale and stays
-- out of the active client lists. The shop now creates them not active. This sets the earlier ones once.
UPDATE clients SET active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE active = 1 AND client_group = 'Open Ledger' AND notes LIKE 'Open Ledger IL shop, order %';
