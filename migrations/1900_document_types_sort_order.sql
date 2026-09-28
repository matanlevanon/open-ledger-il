-- R19 task 7: once 305 and 320 are enabled by the legal-mode switch, the create-new order becomes
-- Invoice/Receipt (320), Invoice (305), Quote, Payment Request, Pro Forma Invoice, Receipt,
-- Credit. Their sort_order moves below every currently-enabled type's (10-50) so this holds the
-- moment the switch flips `enabled`, with no further migration needed then. 320 sorts before 305.
-- Today's patur order (Quote, Payment Request, Pro Forma Invoice, Receipt, Credit) is unaffected:
-- 305 and 320 stay disabled until the switch, so they are not shown either way.
UPDATE document_types SET sort_order = 2 WHERE code = '320';
UPDATE document_types SET sort_order = 4 WHERE code = '305';
