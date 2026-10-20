import { env } from 'cloudflare:workers';
import type { AuditActor } from '../../../src/core/audit';
import { createApp } from '../../../src/index';
import { type Scope, createApiKey } from '../../../src/modules/api/keys';

/** R41 test helpers: an app with a fake client copy PDF, keys, and calls to /v1. */

export const FAKE_PDF = new TextEncoder().encode('%PDF-1.4 fake client copy');
export const app = createApp({ api: { clientPdf: async () => FAKE_PDF } });

export function ownerActor(businessId = 1): AuditActor {
  return { userId: null, email: 'owner@example.com', role: 'owner', ip: null, userAgent: null, businessId };
}

export async function makeKey(scope: Scope = 'read', businessId = 1, name = `Key ${crypto.randomUUID().slice(0, 6)}`) {
  return createApiKey(env.DB, ownerActor(businessId), name, scope);
}

export async function v1(path: string, opts: { key?: string; business?: string | null; method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.key) headers.Authorization = `Bearer ${opts.key}`;
  if (opts.business !== null) headers['X-Business-Id'] = opts.business ?? '1';
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(`/v1${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }, env);
  const type = res.headers.get('content-type') ?? '';
  const body = type.includes('application/json') ? ((await res.json()) as any) : await res.arrayBuffer();
  return { status: res.status, headers: res.headers, body };
}

/** Every value of every row of every table, to search for something that must not be stored. */
export async function wholeDatabase(): Promise<string> {
  const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'").all<{ name: string }>();
  let out = '';
  for (const { name } of tables.results) out += JSON.stringify((await env.DB.prepare(`SELECT * FROM "${name}"`).all()).results);
  return out;
}

export { env };
