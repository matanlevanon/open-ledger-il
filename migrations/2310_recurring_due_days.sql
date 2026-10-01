-- Payment terms for recurring documents: each copy gets a due date this many days after it is
-- issued. Null keeps the template's own due-date gap.
ALTER TABLE recurring_schedules ADD COLUMN due_days INTEGER CHECK (due_days IS NULL OR (due_days BETWEEN 0 AND 365));
