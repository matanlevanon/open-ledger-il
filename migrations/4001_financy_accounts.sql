-- R40 task 3b: the owner picks the business accounts. One Financy user holds personal and business
-- money together, so only the picked CHECKING and CARD accounts are ever synced or stored.

-- JSON array of picked Financy account ids. Null or empty: nothing picked, the sync does nothing.
ALTER TABLE financy_connection ADD COLUMN account_ids TEXT;

-- One account can hold several currencies. JSON: [{ "currency", "balanceMinor", "balanceType" }].
ALTER TABLE bank_accounts ADD COLUMN balances_json TEXT;
ALTER TABLE bank_accounts ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;
