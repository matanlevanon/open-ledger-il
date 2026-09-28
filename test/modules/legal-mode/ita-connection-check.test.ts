import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { all } from '../../../src/core/db';
import { createApp } from '../../../src/index';
import { createClientsModule } from '../../../src/modules/clients';
import { createDocumentsModule } from '../../../src/modules/documents';
import type { CeilingGuard } from '../../../src/modules/documents/ceiling';
import { createLegalModeModule } from '../../../src/modules/legal-mode';
import { FakeFxHistory, FxRates } from '../../../src/modules/fx';
import { RATES } from '../../fixtures/documents/rates';

/**
 * docs/legal-requirements.md, "Switch from פטור to מורשה", point 4: after confirmation, one of
 * the three follow-ups is an "ITA connection check". A separate file from
 * routes.test.ts/reprice-drafts.test.ts because the switch runs at most once ever per D1
 * instance (PLAN.md decision 2), and each file in this suite gets its own isolated D1.
 */

const passThroughCeiling: CeilingGuard = { async check() {} };
const TODAY = '2026-11-20';

function app(itaConnectionCheck?: () => Promise<{ connected: boolean }>) {
  const fx = new FxRates(env.DB, new FakeFxHistory(RATES));
  const documentsOptions = { fx: () => fx, ceiling: passThroughCeiling, today: () => TODAY };
  return createApp({
    modules: [
      createClientsModule({ today: () => TODAY }),
      createDocumentsModule(documentsOptions),
      createLegalModeModule({ documentsOptions, itaConnectionCheck }),
    ],
  });
}

async function switchRequest(instance: ReturnType<typeof app>, body: unknown) {
  return instance.request(
    '/api/legal-mode/switch',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: 'owner@example.com' },
  );
}

describe('the ITA connection check after confirming the switch', () => {
  it('audits the real connection status when a check is wired in', async () => {
    const instance = app(async () => ({ connected: true }));
    const res = await switchRequest(instance, { effectiveDate: TODAY, reason: 'test' });
    expect(res.status).toBe(200);

    const rows = await all<{ action: string; details: string }>(
      env.DB,
      "SELECT action, details FROM audit_log WHERE action = 'legal_mode.ita_connection_check'",
    );
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.details)).toMatchObject({ connected: true });
  });
});
