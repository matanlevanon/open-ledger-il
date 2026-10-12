import { env } from 'cloudflare:workers';
import { todayIsrael } from '../../../src/core/db';
import { createApp } from '../../../src/index';
import { createClientsModule } from '../../../src/modules/clients';
import { createDashboardModule } from '../../../src/modules/dashboard';
import { createDocumentsModule } from '../../../src/modules/documents';
import type { CeilingGuard } from '../../../src/modules/documents/ceiling';
import { FakeFxHistory, FxRates } from '../../../src/modules/fx';
import { createLegalModeModule } from '../../../src/modules/legal-mode';
import { RATES } from '../../fixtures/documents/rates';

/** R24 Phase A: the app with legal-mode and dashboard, on the real date the switch routes use. */
export const TODAY = todayIsrael();

const passThroughCeiling: CeilingGuard = { async check() {} };

export function businessTypeApp() {
  const fx = new FxRates(env.DB, new FakeFxHistory(RATES));
  const documentsOptions = { fx: () => fx, ceiling: passThroughCeiling, today: () => TODAY };
  return createApp({
    modules: [
      createClientsModule({ today: () => TODAY }),
      createDocumentsModule(documentsOptions),
      createLegalModeModule({ documentsOptions }),
      createDashboardModule({ today: () => TODAY }),
    ],
  });
}

export async function call(
  app: ReturnType<typeof businessTypeApp>,
  method: string,
  path: string,
  body?: unknown,
  envOverrides: Record<string, unknown> = {},
) {
  const res = await app.request(
    `/api${path}`,
    { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: 'owner@example.com', ...envOverrides },
  );
  return { status: res.status, body: (await res.json()) as any };
}
