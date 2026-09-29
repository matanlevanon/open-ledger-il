-- An imported past document names the service it was for, from the services catalog (items).
-- It feeds Sales by service and the dashboard's services card. Null until set with Edit.
ALTER TABLE external_documents ADD COLUMN item_id INTEGER REFERENCES items (id);
