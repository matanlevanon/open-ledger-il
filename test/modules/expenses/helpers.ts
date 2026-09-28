import { env } from 'cloudflare:workers';
import { createApp } from '../../../src/index';
import { createExpensesModule } from '../../../src/modules/expenses';
import { FakeDriveSource, FakeExtractor } from '../../../src/modules/expenses/fakes';
import { FakeFxHistory, FxRates } from '../../../src/modules/fx';
import type { Deps } from '../../../src/modules/expenses/service';

export { env };

/** Builds the Worker app with the expenses module wired to fakes (runs/_common.md: no test calls the internet). */
export function buildApp(deps: Partial<Deps> = {}) {
  const full: Deps = {
    drive: deps.drive ?? new FakeDriveSource(),
    extractor: deps.extractor ?? new FakeExtractor(),
    fx: deps.fx ?? new FxRates(env.DB, new FakeFxHistory({})),
  };
  return createApp({ modules: [createExpensesModule(() => full)] });
}

/** Calls /api/expenses<path> as the dev-bypass owner (or another dev email via envOverride). Pass '' for the collection root. */
export function call(app: ReturnType<typeof buildApp>, path: string, init: RequestInit = {}, envOverride: Record<string, unknown> = {}) {
  return app.request(`/api/expenses${path === '/' ? '' : path}`, init, { ...env, ...envOverride });
}

export function json(body: unknown, init: RequestInit = {}): RequestInit {
  return { ...init, method: init.method ?? 'POST', headers: { 'Content-Type': 'application/json', ...init.headers }, body: JSON.stringify(body) };
}

export function uploadForm(bytes: ArrayBuffer, filename: string, contentType: string): FormData {
  const form = new FormData();
  form.append('file', new File([bytes], filename, { type: contentType }));
  return form;
}

export function bytesFrom(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

export const ACCOUNTANT_ENV = { DEV_AUTH_EMAIL: 'cpa@example.com' };
