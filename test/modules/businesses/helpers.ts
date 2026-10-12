import { env } from 'cloudflare:workers';
import { createApp } from '../../../src/index';
import { accessModule } from '../../../src/modules/access';
import { createBusinessesModule } from '../../../src/modules/businesses';
import { createClientsModule } from '../../../src/modules/clients';
import { createDashboardModule } from '../../../src/modules/dashboard';
import { createDocumentsModule, type DocumentsModuleOptions } from '../../../src/modules/documents';
import { FakeFxHistory, FxRates } from '../../../src/modules/fx';
import { createLegalModeModule } from '../../../src/modules/legal-mode';
import { opsModule } from '../../../src/modules/ops';
import { reportsModule } from '../../../src/modules/reports';
import { RATES } from '../../fixtures/documents/rates';

export const TODAY = '2026-11-20';
export const OWNER = 'owner@example.com';

/** The app with every module the R24 Phase B tests reach, real modules, no ITA calls. */
export function businessesApp() {
  const fx = new FxRates(env.DB, new FakeFxHistory(RATES));
  const documentsOptions: DocumentsModuleOptions = { fx: () => fx, ceiling: { async check() {} }, today: () => TODAY };
  return createApp({
    modules: [
      createClientsModule({ today: () => TODAY }),
      createDocumentsModule(documentsOptions),
      createLegalModeModule({ documentsOptions }),
      createBusinessesModule(documentsOptions),
      createDashboardModule({ today: () => TODAY }),
      accessModule,
      opsModule,
      reportsModule,
    ],
  });
}

export type App = ReturnType<typeof businessesApp>;

/** One API call as `email`, in business `businessId` (the X-Business-Id header) when given. */
export async function callIn(app: App, email: string, businessId: number | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (businessId !== null) headers['X-Business-Id'] = String(businessId);
  const res = await app.request(
    `/api${path}`,
    { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: email },
  );
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
}

export async function okIn(app: App, email: string, businessId: number | null, method: string, path: string, body?: unknown) {
  const res = await callIn(app, email, businessId, method, path, body);
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** A final payment request for a new client of the business. Returns the document. */
export async function finalPaymentRequest(app: App, businessId: number, amountMinor = 10000) {
  const client = await okIn(app, OWNER, businessId, 'POST', '/clients', { nameEn: `Client ${crypto.randomUUID().slice(0, 6)}`, country: 'IL' });
  const draft = await okIn(app, OWNER, businessId, 'POST', '/documents', {
    type: 'PR',
    clientId: client.client.id,
    date: TODAY,
    lines: [{ description: 'Work', unitPriceMinor: amountMinor }],
  });
  const id = draft.document.id as number;
  await okIn(app, OWNER, businessId, 'POST', `/documents/${id}/finalize`, {});
  return { id, clientId: client.client.id as number };
}
