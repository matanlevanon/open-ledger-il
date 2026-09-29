import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/core/db';
import { createApp } from '../../src/index';
import { createDashboardModule } from '../../src/modules/dashboard';
import type { ActivityItem } from '../../src/modules/dashboard/activity';
import { db, makeDraft } from '../helpers';

// Rows from other tests stay in the database, so these rows are stamped far in the future to
// sort first.

function app() {
  return createApp({ modules: [createDashboardModule({ today: () => '2026-10-06' })] });
}

async function activity(query = ''): Promise<ActivityItem[]> {
  const res = await app().request(`/api/dashboard/activity${query}`, {}, env);
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: ActivityItem[] }).items;
}

describe('dashboard: recent activity', () => {
  it('lists documents and expenses together, newest first', async () => {
    const { lastRowId: supplierId } = await run(db(), `INSERT INTO suppliers (name) VALUES ('Coffee Lab')`);
    const { lastRowId: expenseId } = await run(
      db(),
      `INSERT INTO expenses (supplier_id, status, currency, amount_minor, created_at) VALUES (?, 'new', 'ILS', 4200, '2099-01-01T08:00:00.000Z')`,
      supplierId,
    );
    const docId = await makeDraft({ seriesId: 'PR', totalMinor: 150000 });
    await run(db(), `UPDATE documents SET created_at = '2099-01-01T09:00:00.000Z' WHERE id = ?`, docId);

    const items = await activity();
    expect(items[0]).toMatchObject({ kind: 'document', id: docId, type: 'PR', status: 'draft', currency: 'ILS', amountMinor: 150000 });
    expect(items[1]).toMatchObject({ kind: 'expense', id: expenseId, type: null, status: 'new', name: 'Coffee Lab', amountMinor: 4200 });
  });

  it('dates an issued document by its finalized time', async () => {
    const docId = await makeDraft({ seriesId: '400', totalMinor: 9900 });
    await run(
      db(),
      `UPDATE documents SET created_at = '2000-01-01T00:00:00.000Z', finalized_at = '2099-02-01T00:00:00.000Z' WHERE id = ?`,
      docId,
    );
    const items = await activity();
    expect(items[0]).toMatchObject({ kind: 'document', id: docId, at: '2099-02-01T00:00:00.000Z' });
  });

  it('honours the limit and caps it at 50', async () => {
    expect(await activity('?limit=1')).toHaveLength(1);
    const many = await activity('?limit=500');
    expect(many.length).toBeLessThanOrEqual(50);
  });
});
