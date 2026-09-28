-- Client city (English and Hebrew, like the address) and zip code, printed under the address on
-- documents. Existing clients keep an empty city and zip until edited.
ALTER TABLE clients ADD COLUMN city_en TEXT;
ALTER TABLE clients ADD COLUMN city_he TEXT;
ALTER TABLE clients ADD COLUMN postal_code TEXT;
