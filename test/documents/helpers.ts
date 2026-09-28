import { env } from 'cloudflare:workers';
import { ConflictError } from '../../src/core/errors';
import { createApp } from '../../src/index';
import { createClientsModule } from '../../src/modules/clients';
import { createDocumentsModule } from '../../src/modules/documents';
import type { CeilingGuard } from '../../src/modules/documents/ceiling';
import { FakeFxHistory, FxRates } from '../../src/modules/fx';
import { createPaymentMethodsModule } from '../../src/modules/payment-methods';
import { createServicesModule } from '../../src/modules/services';
import { RATES } from '../fixtures/documents/rates';

/** Business date seen by the module. Tests move it forward, never back, because of the series date rule. */
export const clock = { today: '2026-10-06' };

/** R04's `rateOn` over the test cache, backfilled from fixture BOI rates. */
export const fxHistory = new FakeFxHistory(RATES);
export const fx = new FxRates(env.DB, fxHistory);

export const ceiling: CeilingGuard & { calls: { amountIls: number; date: string }[]; block: boolean } = {
  calls: [],
  block: false,
  async check(amountIls, date) {
    this.calls.push({ amountIls, date });
    if (this.block) throw new ConflictError('CEILING_CROSSING', 'This receipt takes turnover past the ceiling.');
  },
};

const app = createApp({
  modules: [
    createClientsModule({ today: () => clock.today }),
    createDocumentsModule({ fx: () => fx, ceiling, today: () => clock.today }),
    createPaymentMethodsModule(),
    createServicesModule(),
  ],
});

export interface ApiResult<T = any> {
  status: number;
  body: T;
}

/** Calls the API as the owner, or as another signed-in email through the dev bypass. */
export async function api<T = any>(method: string, path: string, body?: unknown, as = 'owner@example.com'): Promise<ApiResult<T>> {
  const res = await app.request(
    `/api${path}`,
    {
      method,
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.5' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    { ...env, DEV_AUTH_EMAIL: as },
  );
  return { status: res.status, body: (await res.json()) as T };
}

/** Like api() but throws unless the status is 2xx. */
export async function ok<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await api<T>(method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

export async function makeClient(overrides: Record<string, unknown> = {}): Promise<number> {
  const body = await ok('POST', '/clients', { nameEn: `Client ${crypto.randomUUID().slice(0, 6)}`, ...overrides });
  return body.client.id as number;
}

export const line = (unitPriceMinor: number, description = 'Consulting', quantityMilli = 1000) => ({
  description,
  unitPriceMinor,
  quantityMilli,
});

export const pay = (amountMinor: number, paidOn = clock.today, method = 'bank_transfer', extra: Record<string, unknown> = {}) => ({
  method,
  paidOn,
  amountMinor,
  ...extra,
});

/** Creates a draft and finalizes it. Returns the document view. */
export async function issue(type: string, input: Record<string, unknown>): Promise<any> {
  const draft = await ok('POST', '/documents', { type, ...input });
  return ok('POST', `/documents/${draft.document.id}/finalize`, {});
}

export async function makeAccountant(email: string, features: string[]): Promise<void> {
  const { lastRowId } = await (async () => {
    const r = await env.DB.prepare("INSERT INTO users (email, role) VALUES (?, 'accountant')").bind(email).run();
    return { lastRowId: r.meta.last_row_id };
  })();
  for (const f of features) {
    await env.DB.prepare('INSERT INTO user_features (user_id, feature, enabled) VALUES (?, ?, 1)').bind(lastRowId, f).run();
  }
}
