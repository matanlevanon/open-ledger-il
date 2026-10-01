-- latest_rate: a foreign-currency receipt converts each payment at the Bank of Israel rate of its
-- payment day, instead of the rate of the document it was made from. Frozen with the document
-- through the document_meta triggers, like carry_rate.
ALTER TABLE document_meta ADD COLUMN latest_rate INTEGER NOT NULL DEFAULT 0 CHECK (latest_rate IN (0, 1));
