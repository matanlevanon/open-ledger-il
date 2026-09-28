-- A client has one address, in whichever language fits the client, plus city and zip code.
-- address_en holds that single address from now on. address_he is no longer written: a client
-- that only had a Hebrew address keeps it, moved into address_en.
ALTER TABLE clients ADD COLUMN city TEXT;
ALTER TABLE clients ADD COLUMN postal_code TEXT;
UPDATE clients SET address_en = address_he
 WHERE (address_en IS NULL OR trim(address_en) = '') AND address_he IS NOT NULL AND trim(address_he) <> '';
