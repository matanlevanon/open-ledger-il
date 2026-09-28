import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { FakeAccessNotifier } from '../../src/modules/access/notifier';
import { runAccessExpiryCheck } from '../../src/modules/access/expiry';
import { ACCOUNTANT_FEATURES, OWNER_ONLY_FEATURES } from '../../src/core/auth';
import { all } from '../../src/core/db';
import { buildE2eApp, callAs, makeClient, okAs } from './helpers';

/**
 * test/modules/access/accountant-boundaries.test.ts was written against a synthetic stand-in
 * module (its own comment: "Those modules... are not in this branch yet"), because at the time
 * R09 shipped, R01/R12/R14's real documents/ita/ops modules did not exist on that branch yet.
 * They all exist on main now. This is the end-to-end follow-through R15 owes: the SAME boundary
 * (an accountant with every feature switch on, still refused every owner-only action) proven
 * against the real registered routes, not a lookalike, plus the two things a single-module test
 * can't show: every accountant call landing in `audit_log` (CLAUDE.md rule 6) across different
 * real modules in one session, and the access-expiry cron actually cutting off a live session's
 * next request.
 */

const TODAY = '2026-11-20';
const ACCOUNTANT_EMAIL = 'cpa-e2e@example.com';

const app = buildE2eApp({ today: () => TODAY });

async function makeFullyFeaturedAccountant(email: string, accessEndsOn: string | null = null): Promise<number> {
  const inserted = await env.DB.prepare('INSERT INTO users (email, role, access_ends_on) VALUES (?, ?, ?)')
    .bind(email, 'accountant', accessEndsOn)
    .run();
  const userId = inserted.meta.last_row_id as number;
  for (const feature of ACCOUNTANT_FEATURES) {
    await env.DB.prepare('INSERT INTO user_features (user_id, feature, enabled) VALUES (?, ?, 1)').bind(userId, feature).run();
  }
  return userId;
}

let clientId: number;

beforeAll(async () => {
  await makeFullyFeaturedAccountant(ACCOUNTANT_EMAIL);
  clientId = await makeClient(app, { vatNumber: '514713288' });
  await okAs(app, 'owner@example.com', 'POST', '/documents', { type: 'QT', clientId, lines: [{ description: 'Quote', unitPriceMinor: 10000 }] });
});

describe('a fully-featured accountant, across the real registered modules', () => {
  it('reaches the routes docs/accountant-access.md actually grants: clients, documents, exports', async () => {
    expect((await callAs(app, ACCOUNTANT_EMAIL, 'GET', '/clients')).status).toBe(200);
    expect((await callAs(app, ACCOUNTANT_EMAIL, 'GET', `/clients/${clientId}`)).status).toBe(200);
    expect((await callAs(app, ACCOUNTANT_EMAIL, 'GET', '/documents')).status).toBe(200);
    expect((await callAs(app, ACCOUNTANT_EMAIL, 'GET', '/exports/unified-file/report')).status).toBe(200);
  });

  it('never reaches an owner-only feature, whatever the switches say (issue_documents, settings, numbering, ita, users)', async () => {
    for (const feature of OWNER_ONLY_FEATURES) expect(ACCOUNTANT_FEATURES as readonly string[]).not.toContain(feature);

    expect((await callAs(app, ACCOUNTANT_EMAIL, 'POST', '/clients', { nameEn: 'Nope' })).status).toBe(403);
    expect((await callAs(app, ACCOUNTANT_EMAIL, 'POST', '/documents', { type: 'QT', clientId, lines: [{ description: 'x', unitPriceMinor: 100 }] })).status).toBe(
      403,
    );
    expect((await callAs(app, ACCOUNTANT_EMAIL, 'POST', '/legal-mode/switch', { effectiveDate: TODAY })).status).toBe(403);
    expect((await callAs(app, ACCOUNTANT_EMAIL, 'GET', '/ita/status')).status).toBe(403);
  });

  it('every one of the accountant calls above landed in audit_log (CLAUDE.md rule 6), across every module touched', async () => {
    const rows = await all<{ action: string; role: string; entity: string | null }>(
      env.DB,
      `SELECT action, role, entity FROM audit_log WHERE user_email = ? AND action = 'request' ORDER BY id`,
      ACCOUNTANT_EMAIL,
    );
    expect(rows.length).toBeGreaterThanOrEqual(8); // every call in both tests above, allowed or refused
    expect(rows.every((r) => r.role === 'accountant')).toBe(true);
    expect(rows.some((r) => r.entity === 'route')).toBe(true);
  });
});

describe('access expiry really cuts off a live session, not just the row in the DB', () => {
  it('an accountant who could call the API yesterday is refused today, once the daily cron has run', async () => {
    const email = 'cpa-expiring@example.com';
    await makeFullyFeaturedAccountant(email, TODAY); // ends today: still active until the cron runs

    expect((await callAs(app, email, 'GET', '/clients')).status).toBe(200);

    await runAccessExpiryCheck(env.DB, new FakeAccessNotifier(), TODAY);

    const stillCalling = await callAs(app, email, 'GET', '/clients');
    expect(stillCalling.status).toBe(403);
    const body = await stillCalling.json<any>();
    expect(body.error.message).toMatch(/disabled/);
  });
});
