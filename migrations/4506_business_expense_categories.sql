-- R48 task 6: expense categories per business. The shared expense_categories rows stay the
-- defaults, edited by Ledger admins only. A business renames, hides or reorders a default with a
-- row here keyed by the default's key, and adds its own category: a row in expense_categories with
-- the key `b<businessId>:<slug>` (so expenses.category_id keeps one foreign key) and a row here with
-- own = 1. Default lists leave the `b<id>:` keys out. src/modules/expenses/categories.ts reads both.
CREATE TABLE business_expense_categories (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses (id),
  category_key TEXT NOT NULL,
  own INTEGER NOT NULL DEFAULT 0 CHECK (own IN (0, 1)),
  name_en TEXT,
  name_he TEXT,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  sort_order INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (business_id, category_key)
);
