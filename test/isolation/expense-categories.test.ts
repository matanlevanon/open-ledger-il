import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { first, run } from '../../src/core/db';
import { createApp } from '../../src/index';
import { expensesByCategory } from '../../src/modules/reports/aggregates';

/**
 * R48 task 6: expense categories per business. Two businesses with different lists, reports by
 * the business's own names, a hidden category with expenses refused, and the single edition with
 * no overrides as before.
 */
const app = createApp();
const OWNER = 'owner@example.com';

async function call(businessId: number, method: string, path: string, body?: unknown) {
  const res = await app.request(
    `/api${path}`,
    { method, headers: { 'content-type': 'application/json', 'X-Business-Id': String(businessId) }, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: OWNER },
  );
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
}

let A = 0;
let B = 0;
let defaults: { id: number; key: string; name_en: string }[] = [];

beforeAll(async () => {
  await call(1, 'GET', '/businesses');
  A = (await call(1, 'POST', '/businesses', { entityType: 'company', nameEn: 'Cat A', nameHe: 'א', taxId: '514000157', addressEn: 'X' })).body.businessId;
  B = (await call(1, 'POST', '/businesses', { entityType: 'company', nameEn: 'Cat B', nameHe: 'ב', taxId: '514000165', addressEn: 'X' })).body.businessId;
  defaults = (await call(1, 'GET', '/expenses/categories')).body.categories;
});

describe('R48 expense categories per business', () => {
  it('with no overrides, every business sees the defaults, as before', async () => {
    expect(defaults.length).toBeGreaterThan(0);
    const a = (await call(A, 'GET', '/expenses/categories')).body.categories;
    expect(a.map((c: { id: number }) => c.id)).toEqual(defaults.map((c) => c.id));
    expect(a.map((c: { name_en: string }) => c.name_en)).toEqual(defaults.map((c) => c.name_en));
  });

  it('two businesses keep different lists: a rename, a hidden one and an own one', async () => {
    const first1 = defaults[0]!;
    const second = defaults[1]!;
    expect((await call(A, 'PUT', `/expenses/business-categories/${encodeURIComponent(first1.key)}`, { nameEn: 'Studio rent', nameHe: 'שכירות סטודיו' })).status).toBe(200);
    expect((await call(A, 'PUT', `/expenses/business-categories/${encodeURIComponent(second.key)}`, { hidden: true })).status).toBe(200);
    const own = await call(A, 'POST', '/expenses/business-categories', { nameEn: 'Film stock' });
    expect(own.status).toBe(201);
    const a = (await call(A, 'GET', '/expenses/categories')).body.categories as { id: number; name_en: string; own: number }[];
    const b = (await call(B, 'GET', '/expenses/categories')).body.categories as { id: number; name_en: string }[];
    expect(a.find((c) => c.id === first1.id)!.name_en).toBe('Studio rent');
    expect(a.some((c) => c.id === second.id)).toBe(false);
    expect(a.some((c) => c.name_en === 'Film stock' && c.own === 1)).toBe(true);
    expect(b.find((c) => c.id === first1.id)!.name_en).toBe(first1.name_en);
    expect(b.some((c) => c.id === second.id)).toBe(true);
    expect(b.some((c) => c.name_en === 'Film stock')).toBe(false);
    // The admin's defaults never list a business's own category.
    expect((await call(1, 'GET', '/expenses/categories/defaults')).body.categories.some((c: { name_en: string }) => c.name_en === 'Film stock')).toBe(false);
  });

  it("reports group by the business's names", async () => {
    const cat = defaults[0]!;
    for (const biz of [A, B]) {
      await run(env.DB, "INSERT INTO expenses (category_id, document_date, amount_minor, amount_ils_minor, status, business_id) VALUES (?, '2026-10-05', 1000, 1000, 'filed', ?)", cat.id, biz);
    }
    const a = await expensesByCategory(env.DB, A, '2026-10-01', '2026-10-31');
    const b = await expensesByCategory(env.DB, B, '2026-10-01', '2026-10-31');
    expect(a.rows.map((r) => r.nameEn)).toContain('Studio rent');
    expect(b.rows.map((r) => r.nameEn)).toContain(cat.name_en);
    expect(b.rows.map((r) => r.nameEn)).not.toContain('Studio rent');
  });

  it('a category in use cannot be hidden, and the answer says how many', async () => {
    const cat = defaults[0]!;
    const res = await call(B, 'PUT', `/expenses/business-categories/${encodeURIComponent(cat.key)}`, { hidden: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('category_in_use');
    expect(res.body.error.details).toEqual({ count: 1 });
  });

  it("another business's own category never lands on an expense", async () => {
    const own = await first<{ id: number }>(env.DB, "SELECT c.id FROM expense_categories c JOIN business_expense_categories bc ON bc.category_key = c.key WHERE bc.own = 1 AND bc.business_id = ?", A);
    const expense = await run(env.DB, "INSERT INTO expenses (document_date, amount_minor, status, business_id) VALUES ('2026-10-06', 100, 'new', ?)", B);
    const res = await call(B, 'PATCH', `/expenses/${expense.lastRowId}/review`, { categoryId: own!.id });
    expect(res.status).toBe(400);
  });
});
