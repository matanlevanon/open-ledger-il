-- R42: money that moves between the owner's own accounts is not income or an expense. A card bill paid
-- from the checking account is the same money as the card charges, and a transfer between two picked
-- accounts is no money at all. Such rows stay out of income, expenses, categories, matching and the
-- Bank vs books report.
--   normal        counted
--   own_transfer  between two picked accounts (the R40 rule)
--   card_payment  a checking row that pays a picked card's bill
-- The sync sets `flow` on every row. "Count this" sets it back to normal and locks it, so later syncs keep it.
ALTER TABLE bank_transactions ADD COLUMN flow TEXT NOT NULL DEFAULT 'normal' CHECK (flow IN ('normal', 'own_transfer', 'card_payment'));
ALTER TABLE bank_transactions ADD COLUMN flow_locked INTEGER NOT NULL DEFAULT 0;

-- A card's last statement (closingBooked), next to the current charge in balance_minor.
ALTER TABLE bank_accounts ADD COLUMN statement_minor INTEGER;

-- Backfill: R40 set own transfers aside as ignored. They become own_transfer and wait for matching
-- no more. Card payments are marked by the next sync, which knows the picked cards.
-- The pairs are found once, before any row changes, so both sides of a pair move together.
UPDATE bank_transactions
   SET flow = 'own_transfer', match_status = 'unmatched'
 WHERE id IN (
   SELECT a.id FROM bank_transactions a
     JOIN bank_transactions o
       ON o.business_id = a.business_id
      AND o.id <> a.id
      AND o.booked_on = a.booked_on
      AND o.currency = a.currency
      AND o.amount_minor = -a.amount_minor
      AND o.account_financy_id IS NOT NULL
      AND o.account_financy_id <> a.account_financy_id
    WHERE a.match_status = 'ignored' AND o.match_status = 'ignored'
 );

CREATE INDEX bank_transactions_flow ON bank_transactions (business_id, flow, booked_on);
