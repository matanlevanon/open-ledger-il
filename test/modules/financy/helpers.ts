import { env } from 'cloudflare:workers';
import { run } from '../../../src/core/db';
import type { Env } from '../../../src/env';
import { createApp } from '../../../src/index';
import { createFinancyModule } from '../../../src/modules/financy';
import type { RateSource } from '../../../src/modules/fx';
import { clearFinancyTokenCache } from '../../../src/modules/financy/client';
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, FAKE_USER_ID, FakeFinancy } from '../../../src/modules/financy/fake';

/** A test-only AES key, 32 bytes base64. Not a secret. */
export const TEST_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256)));
export const fenv = { ...(env as unknown as Env), ITA_TOKEN_KEY: TEST_KEY } as Env;
export const CREDS = { clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET, userId: FAKE_USER_ID };
export const TODAY = new Date().toISOString().slice(0, 10);

/** R42: the dashboard converts other currencies with `fx`. Tests pass fake rates, never the Bank of Israel. */
export function financyApp(fake: FakeFinancy, fx?: RateSource) {
  const deps = () => ({ fetch: fake.fetch, pageGapMs: 0, fx });
  return { app: createApp({ modules: [createFinancyModule(deps)] }), module: createFinancyModule(deps), deps: deps() };
}

export async function call(app: ReturnType<typeof createApp>, path: string, init: RequestInit = {}, envOverride: Record<string, unknown> = {}) {
  const res = await app.request(`/api/financy${path}`, init, { ...fenv, ...envOverride });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
}

export const put = (body: unknown): RequestInit => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** The business accounts the tests pick: the checking account and the business card. */
export const BUSINESS_ACCOUNTS = ['acc-checking', 'acc-card'];

/** Connect, then pick the business accounts, which runs the first sync. Returns the pick answer. */
export async function connect(app: ReturnType<typeof createApp>, accountIds = BUSINESS_ACCOUNTS) {
  const connected = await call(app, '', put(CREDS));
  if (connected.status !== 200) throw new Error(`connect -> ${connected.status} ${JSON.stringify(connected.body)}`);
  return call(app, '/picked-accounts', put({ accountIds }));
}

export async function resetFinancy(): Promise<void> {
  clearFinancyTokenCache();
  await run(env.DB, 'DELETE FROM bank_transactions');
  await run(env.DB, 'DELETE FROM bank_accounts');
  await run(env.DB, 'DELETE FROM financy_connection');
}

/** Every value of every row of every table, as one string, to search for something that must not be stored. */
export async function wholeDatabase(): Promise<string> {
  const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'").all<{ name: string }>();
  let out = '';
  for (const { name } of tables.results) {
    const rows = await env.DB.prepare(`SELECT * FROM "${name}"`).all();
    out += JSON.stringify(rows.results);
  }
  return out;
}

export { env, FakeFinancy };
