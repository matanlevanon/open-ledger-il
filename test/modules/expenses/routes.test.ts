import { beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { FakeExtractor } from '../../../src/modules/expenses/fakes';
import type { CategoryRow, ExpenseRow } from '../../../src/modules/expenses/types';
import { ACCOUNTANT_ENV, buildApp, bytesFrom, call, env, json, uploadForm } from './helpers';

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    supplierName: 'Slack',
    supplierId: 'US-SLACK-1',
    documentNumber: 'SLK-1',
    date: '2026-10-01',
    currency: 'USD',
    amount: '8.00',
    vatAmount: null,
    documentType: 'Invoice',
    ...overrides,
  };
}

function buildAppWithFixture(filename: string, extracted: Record<string, unknown>) {
  return buildApp({ extractor: new FakeExtractor({ [filename]: extracted as never }) });
}

describe('expenses: listing and review queue', () => {
  // Storage is isolated per test file, not per test (docs/architecture.md), so each test
  // starts from a clean slate here rather than relying on unique document numbers.
  beforeEach(async () => {
    // expenses and expense_files reference each other, so break the cycle before deleting.
    await run(env.DB, 'UPDATE expenses SET duplicate_of_id = NULL, file_id = NULL');
    await run(env.DB, 'UPDATE expense_files SET expense_id = NULL');
    await run(env.DB, 'DELETE FROM expenses');
    await run(env.DB, 'DELETE FROM expense_files');
    await run(env.DB, 'DELETE FROM suppliers');
  });

  it('filters the list by status', async () => {
    const app = buildAppWithFixture('a.pdf', fixture({ documentNumber: 'A' }));
    await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('a'), 'a.pdf', 'application/pdf') });

    const all = (await (await call(app, '/')).json()) as { expenses: ExpenseRow[] };
    expect(all.expenses).toHaveLength(1);

    const filed = (await (await call(app, '?status=filed')).json()) as { expenses: ExpenseRow[] };
    expect(filed.expenses).toHaveLength(0);

    const nu = (await (await call(app, '?status=new')).json()) as { expenses: ExpenseRow[] };
    expect(nu.expenses).toHaveLength(1);
  });

  it('serves the next expense awaiting review, skipping the one just reviewed', async () => {
    const extractor = new FakeExtractor({
      'a.pdf': fixture({ documentNumber: 'A' }) as never,
      'b.pdf': fixture({ documentNumber: 'B' }) as never,
    });
    const app = buildApp({ extractor });
    const a = ((await (await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('a'), 'a.pdf', 'application/pdf') })).json()) as {
      expense: ExpenseRow;
    }).expense;
    const b = ((await (await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('b'), 'b.pdf', 'application/pdf') })).json()) as {
      expense: ExpenseRow;
    }).expense;

    const next = (await (await call(app, `/next?excludeId=${a.id}`)).json()) as { expense: ExpenseRow | null };
    expect(next.expense?.id).toBe(b.id);

    await call(app, `/${b.id}/status`, json({ status: 'filed' }));
    const afterFiling = (await (await call(app, `/next?excludeId=${a.id}`)).json()) as { expense: ExpenseRow | null };
    expect(afterFiling.expense).toBeNull();
  });

  it('downloads the ingested file for the preview pane', async () => {
    const app = buildAppWithFixture('a.txt', fixture());
    const created = ((await (await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('hello file'), 'a.txt', 'text/plain') })).json()) as {
      expense: ExpenseRow;
    }).expense;
    const filesRes = await call(app, `/${created.id}`);
    const detail = ((await filesRes.json()) as { expense: ExpenseRow }).expense;
    expect(detail.file_id).toBeTruthy();

    const download = await call(app, `/files/${detail.file_id}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get('Content-Type')).toBe('text/plain');
    expect(await download.text()).toBe('hello file');
  });
});

describe('expenses: categories', () => {
  it('seeds the consultant category list', async () => {
    const app = buildApp();
    const res = (await (await call(app, '/categories')).json()) as { categories: CategoryRow[] };
    expect(res.categories.map((c) => c.key)).toEqual([
      'software',
      'advertising',
      'professional_services',
      'bank_fees',
      'travel',
      'equipment',
      'education',
      'communication',
      'other',
    ]);
  });

  it('lets the owner add and deactivate a category', async () => {
    const app = buildApp();
    const created = (await (await call(app, '/categories', json({ key: 'subscriptions', nameEn: 'Subscriptions' }))).json()) as {
      category: CategoryRow;
    };
    expect(created.category.active).toBe(1);

    await call(app, `/categories/${created.category.id}`, json({ active: false }, { method: 'PATCH' }));
    const active = (await (await call(app, '/categories')).json()) as { categories: CategoryRow[] };
    expect(active.categories.some((c) => c.key === 'subscriptions')).toBe(false);

    const withInactive = (await (await call(app, '/categories?all=1')).json()) as { categories: CategoryRow[] };
    expect(withInactive.categories.some((c) => c.key === 'subscriptions')).toBe(true);
  });
});

describe('expenses: Drive root folder setting', () => {
  beforeEach(async () => {
    await run(env.DB, `INSERT OR IGNORE INTO users (email, role) VALUES ('cpa@example.com', 'accountant')`);
    await run(
      env.DB,
      `INSERT OR REPLACE INTO user_features (user_id, feature, enabled)
       SELECT id, 'expenses', 1 FROM users WHERE email = 'cpa@example.com'`,
    );
  });

  it('starts unset, and the owner can set it', async () => {
    const app = buildApp();
    const before = (await (await call(app, '/settings/drive-root-folder')).json()) as { folderId: string | null };
    expect(before.folderId).toBeNull();

    const put = await call(app, '/settings/drive-root-folder', json({ folderId: 'abc123' }, { method: 'PUT' }));
    expect(put.status).toBe(200);

    const after = (await (await call(app, '/settings/drive-root-folder')).json()) as { folderId: string | null };
    expect(after.folderId).toBe('abc123');
  });

  it('refuses the accountant', async () => {
    const app = buildApp();
    const res = await call(app, '/settings/drive-root-folder', json({ folderId: 'abc' }, { method: 'PUT' }), ACCOUNTANT_ENV);
    expect(res.status).toBe(403);
  });
});
