-- R18 task 2: the Hebrew name of document type PF is "חשבון עסקה" everywhere, not "חשבונית
-- פרופורמה" (R17 task 4's original name). English name "Pro Forma Invoice" is unchanged.
UPDATE document_types SET name_he = 'חשבון עסקה' WHERE code = 'PF';
UPDATE series SET name_he = 'חשבון עסקה' WHERE id = 'PF';
