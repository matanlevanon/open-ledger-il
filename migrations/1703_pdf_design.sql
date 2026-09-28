-- R17 task 6: PDF design. Adds the tagline printed under the business name in the header.
-- Editable in Settings > Business, never hard-coded in the template. Starts empty.
ALTER TABLE business_profile ADD COLUMN tagline_en TEXT;
ALTER TABLE business_profile ADD COLUMN tagline_he TEXT;
