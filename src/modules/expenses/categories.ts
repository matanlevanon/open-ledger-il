import { type AuditActor, actorBiz, auditStatement } from '../../core/audit';
import { all, first, nowIso, stmt, transaction } from '../../core/db';
import { DomainError, NotFoundError, ValidationError } from '../../core/errors';

/**
 * R48 task 6: the expense categories of one business. Defaults minus hidden, plus its own, its
 * names over the defaults. Every reader of expense_categories goes through `businessCategories`,
 * or joins with CATEGORY_JOIN and reads CATEGORY_NAME_EN / CATEGORY_NAME_HE.
 * A business with no rows here sees exactly the defaults, as before.
 */

export interface BusinessCategory {
  id: number;
  key: string;
  name_en: string;
  name_he: string | null;
  sort_order: number;
  active: number;
  hidden: number;
  own: number;
  /** The default's own name, when the business renamed it. */
  default_name_en: string | null;
}

/** Keys of categories that belong to one business. Default lists leave them out. */
export const OWN_KEY_GLOB = 'b[0-9]*:*';

/**
 * A join for a query over expenses `e` with categories `c`: the business's override of that
 * category. Use with CATEGORY_NAME_EN.
 */
export const CATEGORY_JOIN = 'LEFT JOIN business_expense_categories bc ON bc.business_id = e.business_id AND bc.category_key = c.key';
export const CATEGORY_NAME_EN = "COALESCE(NULLIF(bc.name_en, ''), c.name_en)";
export const CATEGORY_NAME_HE = "NULLIF(bc.name_he, '')";

export async function businessCategories(db: D1Database, businessId: number, includeHidden = false): Promise<BusinessCategory[]> {
  const rows = await all<BusinessCategory>(
    db,
    `SELECT c.id, c.key, COALESCE(NULLIF(bc.name_en, ''), c.name_en) AS name_en, NULLIF(bc.name_he, '') AS name_he,
            COALESCE(bc.sort_order, c.sort_order) AS sort_order, c.active, COALESCE(bc.hidden, 0) AS hidden, COALESCE(bc.own, 0) AS own,
            CASE WHEN NULLIF(bc.name_en, '') IS NOT NULL AND bc.own = 0 THEN c.name_en ELSE NULL END AS default_name_en
       FROM expense_categories c
       LEFT JOIN business_expense_categories bc ON bc.business_id = ? AND bc.category_key = c.key
      WHERE (? = 1 OR c.active = 1) AND (c.key NOT GLOB '${OWN_KEY_GLOB}' OR (bc.own = 1 AND bc.business_id = ?))
      ORDER BY COALESCE(bc.sort_order, c.sort_order), COALESCE(NULLIF(bc.name_en, ''), c.name_en)`,
    businessId,
    includeHidden ? 1 : 0,
    businessId,
  );
  return includeHidden ? rows : rows.filter((r) => r.hidden !== 1);
}

/**
 * The categories of one business. `includeHidden` (Settings, `?all=1`) also lists hidden ones and
 * defaults an admin turned off, as `?all=1` always did.
 */
/** True when the category may be set on an expense of this business: a visible default or its own. */
export async function categoryUsableIn(db: D1Database, businessId: number, categoryId: number): Promise<boolean> {
  return (await businessCategories(db, businessId)).some((c) => c.id === categoryId);
}

async function inUse(db: D1Database, businessId: number, categoryId: number): Promise<number> {
  return (await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM expenses WHERE business_id = ? AND category_id = ?', businessId, categoryId))?.n ?? 0;
}

export interface CategoryChange {
  nameEn?: string | null;
  nameHe?: string | null;
  hidden?: boolean;
  sortOrder?: number | null;
}

/** Renames, hides or reorders a category for the actor's business. Hiding one in use is refused. */
export async function changeBusinessCategory(db: D1Database, actor: AuditActor, key: string, input: CategoryChange): Promise<BusinessCategory[]> {
  const businessId = actorBiz(actor);
  const category = (await businessCategories(db, businessId, true)).find((c) => c.key === key);
  if (!category) throw new NotFoundError('Category', key);
  if (input.hidden === true && category.hidden !== 1) {
    const n = await inUse(db, businessId, category.id);
    if (n > 0) {
      throw new DomainError('category_in_use', `${n} expenses use this category. Move them to another category first.`, 409, { count: n });
    }
  }
  const row = await first<{ name_en: string | null; name_he: string | null; hidden: number; sort_order: number | null }>(
    db,
    'SELECT name_en, name_he, hidden, sort_order FROM business_expense_categories WHERE business_id = ? AND category_key = ?',
    businessId,
    key,
  );
  const next = {
    name_en: input.nameEn === undefined ? (row?.name_en ?? null) : input.nameEn?.trim() || null,
    name_he: input.nameHe === undefined ? (row?.name_he ?? null) : input.nameHe?.trim() || null,
    hidden: input.hidden === undefined ? (row?.hidden ?? 0) : input.hidden ? 1 : 0,
    sort_order: input.sortOrder === undefined ? (row?.sort_order ?? null) : input.sortOrder,
  };
  await transaction(db, [
    stmt(
      db,
      `INSERT INTO business_expense_categories (business_id, category_key, own, name_en, name_he, hidden, sort_order)
       VALUES (?, ?, 0, ?, ?, ?, ?)
       ON CONFLICT (business_id, category_key) DO UPDATE SET name_en = excluded.name_en, name_he = excluded.name_he,
         hidden = excluded.hidden, sort_order = excluded.sort_order, updated_at = ?`,
      businessId,
      key,
      next.name_en,
      next.name_he,
      next.hidden,
      next.sort_order,
      nowIso(),
    ),
    auditStatement(db, actor, 'category.business_update', 'expense_category', key, input),
  ]);
  return businessCategories(db, businessId, true);
}

/** Adds a category of the actor's business only. */
export async function addBusinessCategory(db: D1Database, actor: AuditActor, input: { nameEn: string; nameHe?: string | null }): Promise<BusinessCategory[]> {
  const businessId = actorBiz(actor);
  const nameEn = input.nameEn.trim();
  if (!nameEn) throw new ValidationError('Name the category.');
  const slug = nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'category';
  const key = `b${businessId}:${slug}-${crypto.randomUUID().slice(0, 6)}`;
  const max = (await first<{ n: number | null }>(db, 'SELECT MAX(sort_order) AS n FROM expense_categories'))?.n ?? 0;
  await transaction(db, [
    stmt(db, 'INSERT INTO expense_categories (key, name_en, sort_order) VALUES (?, ?, ?)', key, nameEn, max + 1),
    stmt(
      db,
      'INSERT INTO business_expense_categories (business_id, category_key, own, name_en, name_he) VALUES (?, ?, 1, ?, ?)',
      businessId,
      key,
      nameEn,
      input.nameHe?.trim() || null,
    ),
    auditStatement(db, actor, 'category.business_create', 'expense_category', key, { nameEn }),
  ]);
  return businessCategories(db, businessId, true);
}
