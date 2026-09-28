-- R18 task 6: an active flag on clients, replacing the archive/unarchive action. Default active;
-- an existing archived client (archived_at set) becomes not active. archived_at itself is left in
-- place (harmless, unused going forward) rather than dropped: it is not legally significant like a
-- document field, just no longer the field the app reads or writes.
ALTER TABLE clients ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1));
UPDATE clients SET active = 0 WHERE archived_at IS NOT NULL;
