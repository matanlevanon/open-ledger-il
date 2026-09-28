-- R21 task 4: an index for the dashboard and report aggregates, added because the query plan
-- needed it. Every period query reads final documents in a date range. With only
-- documents_status (status, type) the plan searched by status alone, then filtered every final
-- document ever issued by date. With (status, date) it reads only the range.
-- Checked and not needed: expenses (expenses_status already covers status and date),
-- external_documents (external_documents_date), payments (the plan joins through documents).
CREATE INDEX documents_status_date ON documents (status, date);
