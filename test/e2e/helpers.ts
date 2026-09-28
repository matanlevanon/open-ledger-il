import { env } from 'cloudflare:workers';
import type { ModuleDef } from '../../src/core/module';
import { createApp } from '../../src/index';
import { createClientsModule } from '../../src/modules/clients';
import { createDocumentsModule, type DocumentsModuleOptions } from '../../src/modules/documents';
import type { CeilingGuard } from '../../src/modules/documents/ceiling';
import { createExportsModule } from '../../src/modules/exports';
import { FakeFxHistory, FxRates } from '../../src/modules/fx';
import { D1AllocationDocuments, createAllocationService, createItaModule } from '../../src/modules/ita';
import type { ItaEnv } from '../../src/modules/ita/config';
import type { ItaDeps } from '../../src/modules/ita/service';
import { createLegalModeModule } from '../../src/modules/legal-mode';
import { accessModule } from '../../src/modules/access';
import { RATES } from '../fixtures/documents/rates';
import { itaEnv } from '../ita/helpers';
import { MemoryNotifier, MockIta } from '../mocks/ita';

/**
 * True end-to-end wiring: unlike most module tests (which deliberately keep documents/ceiling
 * and documents/allocation decoupled from the real ceiling guard and the real ITA service, per
 * their own doc comments), this harness wires the REAL `createCeilingGuard` and a REAL
 * `ItaAllocationService`, sharing one `MockIta` fake server, into the documents module's
 * `ceiling`/`allocation` hooks -- the same way `src/modules/index.ts` wires the real app. That
 * wiring is what makes these test/e2e/*.test.ts files end-to-end rather than another unit test.
 */
export function makeClock(start = '2026-11-20T08:00:00.000Z') {
  let t = Date.parse(start);
  return {
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
  };
}

export interface E2eApp {
  instance: ReturnType<typeof createApp>;
  ienv: ItaEnv;
  mock: MockIta;
  notifier: MemoryNotifier;
  deps: ItaDeps;
}

/** Builds the full app with every module a whole-lifecycle test needs, real modules only. */
export function buildE2eApp(options: { today?: () => string; ceiling?: CeilingGuard; extraModules?: ModuleDef[] } = {}): E2eApp {
  const today = options.today ?? (() => '2026-11-20');
  const clock = makeClock();
  const mock = new MockIta(clock.now);
  const notifier = new MemoryNotifier();
  const deps: ItaDeps = { fetch: mock.fetch, now: clock.now, notifier: () => notifier, documents: (e) => new D1AllocationDocuments(e.DB) };
  const ienv = itaEnv();

  const fx = new FxRates(env.DB, new FakeFxHistory(RATES));
  const documentsOptions: DocumentsModuleOptions = {
    fx: () => fx,
    ceiling: options.ceiling ?? { async check() {} },
    today,
    allocation: (appEnv) => createAllocationService(appEnv as ItaEnv, deps),
  };

  const instance = createApp({
    modules: [
      createClientsModule({ today }),
      createDocumentsModule(documentsOptions),
      createLegalModeModule({ documentsOptions }),
      createItaModule(deps),
      createExportsModule(),
      accessModule,
      ...(options.extraModules ?? []),
    ],
  });

  return { instance, ienv, mock, notifier, deps };
}

/** Skips the HTTP OAuth dance (already covered by test/ita/routes.test.ts) and connects directly. */
export async function connectIta(app: E2eApp): Promise<void> {
  const code = app.mock.issueCode('tsandbox');
  const service = createAllocationService(app.ienv, app.deps);
  await service.tokens.exchangeCode(code, 'https://ledger.test/api/ita/callback', null);
}

export async function callAs(app: E2eApp, email: string, method: string, path: string, body?: unknown): Promise<Response> {
  return app.instance.request(
    `/api${path}`,
    {
      method,
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.5' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    { ...env, ...app.ienv, DEV_AUTH_EMAIL: email },
  );
}

export async function okAs<T = any>(app: E2eApp, email: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await callAs(app, email, method, path, body);
  if (res.status >= 300) throw new Error(`${method} ${path} as ${email} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function ok<T = any>(app: E2eApp, method: string, path: string, body?: unknown): Promise<T> {
  return okAs<T>(app, 'owner@example.com', method, path, body);
}

export async function makeClient(app: E2eApp, overrides: Record<string, unknown> = {}): Promise<number> {
  const body = await ok(app, 'POST', '/clients', {
    nameEn: `Client ${crypto.randomUUID().slice(0, 6)}`,
    country: 'IL',
    ...overrides,
  });
  return body.client.id as number;
}
