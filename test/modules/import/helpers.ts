import { env } from 'cloudflare:workers';
import { createApp } from '../../../src/index';
import { createImportModule, importModule, type UploadDeps } from '../../../src/modules/import';
import { boiRateSource } from '../../../src/modules/fx';
import { FakeExternalDocExtractor } from '../../../src/modules/import/upload-fakes';

export { env };

/** Builds the Worker app with only the import module registered. */
export function buildApp() {
  return createApp({ modules: [importModule] });
}

/**
 * Builds the app with a fake extractor for "Upload existing documents" tests (R17 task 7):
 * runs/_common.md, "no test calls the internet". `files` defaults to the real R2 test binding
 * (Miniflare's local implementation, no network), `fx` to the real BOI rate source over D1.
 */
export function buildAppWithUpload(byFilename: Record<string, unknown> = {}, overrides: Partial<UploadDeps> = {}) {
  const module = createImportModule((e) => ({
    extractor: new FakeExternalDocExtractor(byFilename as never),
    fx: boiRateSource(e.DB),
    files: e.FILES,
    ...overrides,
  }));
  return createApp({ modules: [module] });
}

/** Calls /api/import<path> as the dev-bypass owner (or another dev email via envOverride). */
export function call(app: ReturnType<typeof buildApp>, path: string, init: RequestInit = {}, envOverride: Record<string, unknown> = {}) {
  return app.request(`/api/import${path === '/' ? '' : path}`, init, { ...env, ...envOverride });
}

export function json(body: unknown, init: RequestInit = {}): RequestInit {
  return { ...init, method: init.method ?? 'POST', headers: { 'Content-Type': 'application/json', ...init.headers }, body: JSON.stringify(body) };
}

export function uploadForm(bytes: ArrayBuffer, filename: string, contentType: string, mapping?: unknown): FormData {
  const form = new FormData();
  form.append('file', new File([bytes], filename, { type: contentType }));
  if (mapping !== undefined) form.append('mapping', JSON.stringify(mapping));
  return form;
}

export function bytesFrom(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

export const ACCOUNTANT_ENV = { DEV_AUTH_EMAIL: 'cpa@example.com' };
