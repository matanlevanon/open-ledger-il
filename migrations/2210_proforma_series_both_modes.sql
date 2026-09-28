-- The pro forma (300, חשבון עסקה) is issued in both עוסק פטור and עוסק מורשה modes. The switch to
-- מורשה never closes its series (src/modules/legal-mode/service.ts closes only 400), so its series
-- label is "both", not patur. Settings > Numbering reads this column.
UPDATE series SET legal_mode = NULL WHERE id = '300';
