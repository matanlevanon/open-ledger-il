-- Seed category list suited to a consultant (CLAUDE.md rule 4: this is data, not a hard-coded rule).
-- Editable afterwards through the categories screen.

INSERT INTO expense_categories (key, name_en, sort_order) VALUES
  ('software', 'Software', 10),
  ('advertising', 'Advertising', 20),
  ('professional_services', 'Professional services', 30),
  ('bank_fees', 'Bank fees', 40),
  ('travel', 'Travel', 50),
  ('equipment', 'Equipment', 60),
  ('education', 'Education', 70),
  ('communication', 'Communication', 80),
  ('other', 'Other', 90);
