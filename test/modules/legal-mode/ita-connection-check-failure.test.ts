import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { all } from '../../../src/core/db';
import { createApp } from '../../../src/index';
import { createClientsModule } from '../../../src/modules/clients';
import { createDocumentsModule } from '../../../src/modules/documents';
import type { CeilingGuard } from '../../../src/modules/documents/ceiling';
import { createLegalModeModule } from '../../../src/modules/legal-mode';
import { FakeFxHistory, FxRates } from '../../../src/modules/fx';
import { RATES } from '../../fixtures/documents/rates';

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

it('a failed ITA connection check never fails the switch itself, and records the failure', async () => {
  const instance = app(async () => {
    throw new Error('ITA not configured');
  });
  const res = await switchRequest(instance, { effectiveDate: TODAY, reason: 'test' });
  expect(res.status).toBe(200);

  const rows = await all<{ details: string }>(env.DB, "SELECT details FROM audit_log WHERE action = 'legal_mode.ita_connection_check'");
  expect(JSON.parse(rows[0]!.details)).toMatchObject({ connected: false, checkFailed: true });
});
