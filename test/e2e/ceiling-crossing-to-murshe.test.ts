import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createCeilingGuard } from '../../src/modules/ceiling';
import { buildE2eApp, makeClient, ok } from './helpers';

/**
 * End-to-end against the REAL ceiling guard (src/modules/ceiling/guard.ts), not the
 * pass-through/fake `CeilingGuard` every other documents test uses. Exercises
 * docs/legal-requirements.md's "Ceiling guard" section end to end: a receipt that would push
 * 2026 turnover past the seeded ₪122,833 ceiling (migrations/0003_seed.sql) is blocked with the
 * CEILING_CROSSING error and its turnover/ceiling/gap detail, the owner picks "Confirm switch"
 * (POST /legal-mode/switch), and the system is now really in עוסק מורשה mode for later documents.
 */

const TODAY = '2026-11-20';

describe('ceiling crossing blocks a receipt, then the owner confirms the real switch', () => {
  it('a receipt under the ceiling passes; one that would cross it is blocked with turnover/ceiling/gap, then the owner switches and issues מורשה instead', async () => {
    const app = buildE2eApp({ today: () => TODAY, ceiling: createCeilingGuard(env.DB, { send: async () => true }) });

    const client = await makeClient(app, { vatNumber: '514713288' });

    // 100,000 ILS receipt: comfortably under the ₪122,833 2026 ceiling.
    const draft = await ok(app, 'POST', '/documents', {
      type: '400',
      clientId: client,
      payments: [{ method: 'bank_transfer', paidOn: TODAY, amountMinor: 10000000 }],
    });
    const under = await ok(app, 'POST', `/documents/${draft.document.id}/finalize`, {});
    expect(under.document.status).toBe('final');

    // A second receipt of 50,000 ILS would take 2026 turnover to 150,000, past the ceiling.
    const draft2 = await ok(app, 'POST', '/documents', {
      type: '400',
      clientId: client,
      payments: [{ method: 'bank_transfer', paidOn: TODAY, amountMinor: 5000000 }],
    });
    const res = await app.instance.request(
      `/api/documents/${draft2.document.id}/finalize`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      { ...env, ...app.ienv, DEV_AUTH_EMAIL: 'owner@example.com' },
    );
    expect(res.status).toBe(409);
    const errBody = await res.json<any>();
    expect(errBody.error.code).toBe('CEILING_CROSSING');
    expect(errBody.error.details).toMatchObject({ year: 2026, turnoverMinor: 10000000, amountMinor: 5000000, limitMinor: 12283300 });
    expect(errBody.error.details.gapMinor).toBe(12283300 - 10000000);

    // The draft is untouched, still open for one of the three actions (confirm switch / issue
    // smaller / cancel). Here: the owner confirms the switch.
    const stillDraft = await ok(app, 'GET', `/documents/${draft2.document.id}`);
    expect(stillDraft.document.status).toBe('draft');

    const switched = await ok(app, 'POST', '/legal-mode/switch', { effectiveDate: TODAY, reason: 'crossed the ceiling' });
    expect(switched.status).toBe('confirmed');
    expect(switched.seriesOpened.slice().sort()).toEqual(['305', '320', '330', '332', '400-M']);

    // The document that triggered the crossing is still just a 400 draft (the switch never
    // touches an open draft unless repriceDrafts is set); re-issue as a real מורשה tax invoice
    // instead, well under the ₪5,000 allocation threshold so it finalizes straight to final.
    const murshe = await ok(app, 'POST', '/documents', { type: '305', clientId: client, lines: [{ description: 'Post-switch invoice', unitPriceMinor: 100000 }] });
    const finalMurshe = await ok(app, 'POST', `/documents/${murshe.document.id}/finalize`, {});
    expect(finalMurshe.document.status).toBe('final');
    expect(finalMurshe.document.vat_amount_minor).toBe(18000);

    // The original crossing receipt can still be issued as a (now-closed-series-free) 400,
    // since 400 stays enabled after the switch (docs/progress.md, R11 fix 1) -- proving "issue as
    // פטור" is simply "finalize a smaller/still-פטור document", not a separate API action.
    const smaller = await ok(app, 'POST', '/documents', {
      type: '400',
      clientId: client,
      payments: [{ method: 'bank_transfer', paidOn: TODAY, amountMinor: 500000 }],
    });
    const finalSmaller = await ok(app, 'POST', `/documents/${smaller.document.id}/finalize`, {});
    expect(finalSmaller.document.status).toBe('final');
  });
});
