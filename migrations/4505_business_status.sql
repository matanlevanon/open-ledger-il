-- R48 task 5: a client who leaves the firm's Ledger. "Mark as moved out" (Ledger admin, typed
-- confirmation, only after an export run with every file built) makes the business read-only: no
-- drafts, finalize, send, payment, ITA call, Financy sync, recurring run or reminder. The data
-- stays for the retention period (instruction 25). There is no delete and no purge.
ALTER TABLE businesses ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'moved_out'));
ALTER TABLE businesses ADD COLUMN moved_out_at TEXT;
ALTER TABLE businesses ADD COLUMN moved_note TEXT;

-- The last wall: no number is ever issued in a moved-out business, whatever path tries.
CREATE TRIGGER finalizations_business_active BEFORE INSERT ON finalizations
WHEN EXISTS (SELECT 1 FROM businesses WHERE id = NEW.business_id AND status = 'moved_out')
BEGIN
  SELECT RAISE(ABORT, 'business_moved_out');
END;

-- A moved-out business never moves back.
CREATE TRIGGER businesses_moved_out_final BEFORE UPDATE OF status ON businesses
WHEN OLD.status = 'moved_out' AND NEW.status != 'moved_out'
BEGIN
  SELECT RAISE(ABORT, 'business_moved_out');
END;
