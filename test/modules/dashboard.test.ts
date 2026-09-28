import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { run } from '../../src/core/db';
import { finalizeDocument } from '../../src/core/numbering';
import { createApp } from '../../src/index';
import { createDashboardModule } from '../../src/modules/dashboard';
import { cacheRate } from '../../src/modules/fx';
import { OWNER_ACTOR, db, makeDraft } from '../helpers';

// Final documents never disappear (CLAUDE.md rule 1), so state from earlier tests in this
// file stays in the database. Every test reads a baseline before acting and asserts the
// delta, instead of assuming a clean ledger.

// Business date for the dashboard. makeDraft dates every document 2026-10-01, the same year and month.
const TODAY = '2026-10-06';

function app() {
  return createApp({ modules: [createDashboardModule({ today: () => TODAY })] });
}

async function get(path: string, envOverride: Record<string, unknown> = {}) {
  return app().request(`/api${path}`, {}, { ...env, ...envOverride });
}

interface DashboardBody {
  overdueRequests: { currency: string; count: number; totalMinor: number }[];
  cards: { cashFlow?: { from: string; to: string; months: { month: string; inflowIlsMinor: number }[] } };
  ceiling: { year: number; currency: string; limitMinor: number; currentMinor: number } | null;
  vatDue: { applicable: boolean; amountMinor: number; currency: string };
  ita: { connected: boolean; message: string };
}

async function dashboard(): Promise<DashboardBody> {
  return (await (await get('/dashboard')).json()) as DashboardBody;
}

function ilsOverdue(body: DashboardBody) {
  return body.overdueRequests.find((r) => r.currency === 'ILS') ?? { currency: 'ILS', count: 0, totalMinor: 0 };
}

describe('dashboard: read endpoint', () => {
  it('answers zeroed for an empty ledger', async () => {
    const body = await dashboard();
    expect(body.overdueRequests).toEqual([]);
    expect(body.ceiling).toEqual({ year: 2026, currency: 'ILS', limitMinor: 12283300, currentMinor: 0 });
    expect(body.vatDue).toEqual({ applicable: false, amountMinor: 0, currency: 'ILS' });
    expect(body.ita.connected).toBe(false);
    expect(body.cards.cashFlow?.months).toHaveLength(12);
    expect(body.cards.cashFlow?.months.every((m) => m.inflowIlsMinor === 0)).toBe(true);
  });

  it('counts a final payment request past its due date as overdue', async () => {
    const before = ilsOverdue(await dashboard());

    const id = await makeDraft({ seriesId: 'PR', totalMinor: 150000 });
    await run(db(), `UPDATE documents SET due_date = '2020-01-01' WHERE id = ?`, id);
    await finalizeDocument(db(), id, { actor: OWNER_ACTOR });

    const after = ilsOverdue(await dashboard());
    expect(after.count).toBe(before.count + 1);
    expect(after.totalMinor).toBe(before.totalMinor + 150000);
  });

  it('drops a request from overdue once it is linked to a payment', async () => {
    const before = ilsOverdue(await dashboard());

    const requestId = await makeDraft({ seriesId: 'PR', totalMinor: 150000 });
    await run(db(), `UPDATE documents SET due_date = '2020-01-01' WHERE id = ?`, requestId);
    await finalizeDocument(db(), requestId, { actor: OWNER_ACTOR });
    expect(ilsOverdue(await dashboard()).count).toBe(before.count + 1);

    const receiptId = await makeDraft({ seriesId: '400', totalMinor: 150000 });
    await finalizeDocument(db(), receiptId, { actor: OWNER_ACTOR });
    await run(
      db(),
      `INSERT INTO document_links (source_id, target_id, kind, amount_minor, currency) VALUES (?, ?, 'payment', 150000, 'ILS')`,
      requestId,
      receiptId,
    );

    const after = ilsOverdue(await dashboard());
    expect(after.count).toBe(before.count);
    expect(after.totalMinor).toBe(before.totalMinor);
  });

  it('keeps a partly paid request overdue for the remainder only (R01 balances)', async () => {
    const before = ilsOverdue(await dashboard());

    const requestId = await makeDraft({ seriesId: 'PR', totalMinor: 150000 });
    await run(db(), `UPDATE documents SET due_date = '2020-01-01' WHERE id = ?`, requestId);
    await finalizeDocument(db(), requestId, { actor: OWNER_ACTOR });
    const receiptId = await makeDraft({ seriesId: '400', totalMinor: 50000 });
    await finalizeDocument(db(), receiptId, { actor: OWNER_ACTOR });
    await run(
      db(),
      `INSERT INTO document_links (source_id, target_id, kind, amount_minor, currency) VALUES (?, ?, 'payment', 50000, 'ILS')`,
      requestId,
      receiptId,
    );

    const after = ilsOverdue(await dashboard());
    expect(after.count).toBe(before.count + 1);
    expect(after.totalMinor).toBe(before.totalMinor + 100000);
  });

  it('adds turnover and open requests into the ceiling meter', async () => {
    const before = (await dashboard()).ceiling?.currentMinor ?? 0;

    const income = await makeDraft({ seriesId: '400', totalMinor: 100000 });
    await finalizeDocument(db(), income, { actor: OWNER_ACTOR });

    const open = await makeDraft({ seriesId: 'PR', totalMinor: 50000 });
    await finalizeDocument(db(), open, { actor: OWNER_ACTOR });

    const after = (await dashboard()).ceiling?.currentMinor ?? 0;
    expect(after - before).toBe(150000);
  });

  it('counts a partial payment once: turnover goes up and the open request goes down by the same amount', async () => {
    const before = (await dashboard()).ceiling?.currentMinor ?? 0;

    const request = await makeDraft({ seriesId: 'PR', totalMinor: 100000 });
    await finalizeDocument(db(), request, { actor: OWNER_ACTOR });
    expect(((await dashboard()).ceiling?.currentMinor ?? 0) - before).toBe(100000);

    const receipt = await makeDraft({ seriesId: '400', totalMinor: 40000 });
    await run(db(), `UPDATE documents SET total_ils_minor = 40000 WHERE id = ?`, receipt);
    await finalizeDocument(db(), receipt, { actor: OWNER_ACTOR });
    await run(
      db(),
      `INSERT INTO document_links (source_id, target_id, kind, amount_minor, currency) VALUES (?, ?, 'payment', 40000, 'ILS')`,
      request,
      receipt,
    );
    expect(((await dashboard()).ceiling?.currentMinor ?? 0) - before).toBe(100000);
  });

  it('projects an open foreign request into the ceiling at the BOI rate from R04 rateOn', async () => {
    await cacheRate(db(), 'USD', { rate: '3.700000', rateDate: TODAY, source: 'boi' });
    const before = (await dashboard()).ceiling?.currentMinor ?? 0;

    const request = await makeDraft({ seriesId: 'PR', totalMinor: 100000, currency: 'USD' });
    await finalizeDocument(db(), request, { actor: OWNER_ACTOR });

    expect(((await dashboard()).ceiling?.currentMinor ?? 0) - before).toBe(370000);
  });

  it('does not add a credit receipt to the ceiling meter', async () => {
    const before = (await dashboard()).ceiling?.currentMinor ?? 0;

    const credit = await makeDraft({ seriesId: '405', totalMinor: -40000 });
    await finalizeDocument(db(), credit, { actor: OWNER_ACTOR });

    const after = (await dashboard()).ceiling?.currentMinor ?? 0;
    expect(after - before).toBe(-40000);
  });

  it('totals cash received in the current month from payments', async () => {
    const month = TODAY.slice(0, 7);
    const inflow = (b: DashboardBody) => b.cards.cashFlow?.months.find((m) => m.month === month)?.inflowIlsMinor ?? 0;
    const before = inflow(await dashboard());

    const id = await makeDraft({ seriesId: '400', totalMinor: 80000, payments: [{ amountMinor: 80000, paidOn: TODAY }] });
    await finalizeDocument(db(), id, { actor: OWNER_ACTOR });

    const after = inflow(await dashboard());
    expect(after - before).toBe(80000);
  });

  describe('the reports feature gate', () => {
    let cpaEmail: string;

    beforeEach(async () => {
      cpaEmail = `cpa-${crypto.randomUUID().slice(0, 8)}@example.com`;
      const acc = await run(db(), `INSERT INTO users (email, role) VALUES (?, 'accountant')`, cpaEmail);
      await run(db(), `INSERT INTO user_features (user_id, feature, enabled) VALUES (?, 'reports', 0)`, acc.lastRowId);
    });

    it('refuses an accountant without the reports feature', async () => {
      const res = await get('/dashboard', { DEV_AUTH_EMAIL: cpaEmail });
      expect(res.status).toBe(403);
    });

    it('admits an accountant once reports is enabled', async () => {
      await run(db(), `UPDATE user_features SET enabled = 1 WHERE feature = 'reports' AND user_id = (SELECT id FROM users WHERE email = ?)`, cpaEmail);
      const res = await get('/dashboard', { DEV_AUTH_EMAIL: cpaEmail });
      expect(res.status).toBe(200);
    });
  });
});
