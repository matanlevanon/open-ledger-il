-- R24 Phase A: פטור to מורשה is one way. Nothing takes a Ledger back to פטור: not the API, not the UI,
-- not the installer and not raw SQL. Never drop or weaken these. Same style as 0002_integrity.sql.
-- Error codes are mapped to typed errors in src/core/errors.ts.

-- legal_modes is append-only.
CREATE TRIGGER legal_modes_no_update BEFORE UPDATE ON legal_modes
BEGIN
  SELECT RAISE(ABORT, 'legal_mode_locked');
END;

CREATE TRIGGER legal_modes_no_delete BEFORE DELETE ON legal_modes
BEGIN
  SELECT RAISE(ABORT, 'legal_mode_locked');
END;

-- Once a מורשה row exists, no פטור row may follow.
CREATE TRIGGER legal_modes_no_patur_after_murshe BEFORE INSERT ON legal_modes
WHEN NEW.mode = 'patur' AND EXISTS (SELECT 1 FROM legal_modes WHERE mode = 'murshe')
BEGIN
  SELECT RAISE(ABORT, 'legal_mode_locked');
END;

-- entity_type moves only osek_patur to osek_murshe, or osek_patur to company on a fresh Ledger.
CREATE TRIGGER business_profile_entity_type_lock BEFORE UPDATE OF entity_type ON business_profile
WHEN NEW.entity_type IS NOT OLD.entity_type
BEGIN
  SELECT RAISE(ABORT, 'entity_type_locked')
  WHERE NOT (
    (OLD.entity_type = 'osek_patur' AND NEW.entity_type = 'osek_murshe')
    OR (OLD.entity_type = 'osek_patur' AND NEW.entity_type = 'company' AND NOT EXISTS (SELECT 1 FROM finalizations))
  );
END;

-- A replaced or re-inserted profile row cannot come back as פטור once the Ledger is מורשה.
CREATE TRIGGER business_profile_insert_lock BEFORE INSERT ON business_profile
WHEN NEW.entity_type = 'osek_patur' AND EXISTS (SELECT 1 FROM legal_modes WHERE mode = 'murshe')
BEGIN
  SELECT RAISE(ABORT, 'entity_type_locked');
END;

CREATE TRIGGER business_profile_no_delete BEFORE DELETE ON business_profile
WHEN OLD.entity_type IS NOT 'osek_patur'
BEGIN
  SELECT RAISE(ABORT, 'entity_type_locked');
END;
