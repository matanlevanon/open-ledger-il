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

function app() {
  const fx = new FxRates(env.DB, new FakeFxHistory(RATES));
  const documentsOptions = { fx: () => fx, ceiling: passThroughCeiling, today: () => TODAY };
  return createApp({
    modules: [
      createClientsModule({ today: () => TODAY }),
      createDocumentsModule(documentsOptions),
      createLegalModeModule({ documentsOptions }), // no itaConnectionCheck: the module default
    ],
  });
}

it('is a no-op when no ITA connection check is wired in (the module default)', async () => {
  const instance = app();
  const res = await instance.request(
    '/api/legal-mode/switch',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ effectiveDate: TODAY, reason: 'test' }) },
    { ...env, DEV_AUTH_EMAIL: 'owner@example.com' },
  );
  expect(res.status).toBe(200);
  const rows = await all(env.DB, "SELECT 1 FROM audit_log WHERE action = 'legal_mode.ita_connection_check'");
  expect(rows).toEqual([]);
});
