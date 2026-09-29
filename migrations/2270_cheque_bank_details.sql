-- Cheque bank details on a payment: bank, branch and account number. The unified file requires
-- them on every cheque line (instructions 1.31, D120 fields 1307 to 1309). Frozen with the
-- document through the payment_details triggers, like cheque_crossed.
ALTER TABLE payment_details ADD COLUMN bank_number TEXT CHECK (bank_number IS NULL OR bank_number GLOB '[0-9]*');
ALTER TABLE payment_details ADD COLUMN branch_number TEXT CHECK (branch_number IS NULL OR branch_number GLOB '[0-9]*');
ALTER TABLE payment_details ADD COLUMN account_number TEXT CHECK (account_number IS NULL OR account_number GLOB '[0-9]*');
