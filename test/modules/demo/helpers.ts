import { env } from 'cloudflare:workers';
import { type AuthUser, FEATURES } from '../../../src/core/auth';
import { run } from '../../../src/core/db';
import type { Env } from '../../../src/env';
import { demoEnv } from '../../../src/modules/demo/config';
import { scopedDb } from '../../../src/modules/demo/scoped-db';
import { createSession } from '../../../src/modules/demo/session';

/** The env a demo Worker runs with: DEMO_MODE on, the fake Tax Authority answering at once. */
export function demoTestEnv(extra: Partial<Env> = {}): Env {
  return {
    ...demoEnv({ ...env, DEMO_MODE: '1' } as Env),
    DEMO_MODE: '1',
    DEMO_ITA_DELAY_MS: '0',
    DEMO_SENDER_NAME: 'Sample Sender',
    DEMO_CTA_URL: 'https://example.com/get-your-own',
    TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    TURNSTILE_SECRET: 'turnstile-test-secret',
    SLACK_WEBHOOK_URL: 'https://hooks.slack.test/demo',
    ...extra,
  } as Env;
}

/** R29: a visitor as the gate makes one: a synthetic user linked to the masters, a session, and its scoped view. */
export async function testVisitor(e: Env, masters: number[], label: string) {
  const email = `visitor-${label}-${crypto.randomUUID()}@sandbox.invalid`;
  const userId = (await run(e.DB, "INSERT INTO users (email, role) VALUES (?, 'owner')", email)).lastRowId;
  for (const id of masters) await run(e.DB, "INSERT INTO user_businesses (user_id, business_id, role) VALUES (?, ?, 'owner')", userId, id);
  const { token, sessionKey } = await createSession(e.DB, { userId });
  const key = sessionKey!;
  const user = (businessId: number): AuthUser => ({
    id: userId,
    email,
    name: null,
    role: 'owner',
    features: [...FEATURES],
    theme: null,
    locale: null,
    businessId,
    businesses: masters.map((id) => ({ id, role: 'owner' as const })),
  });
  const actor = (businessId: number) => ({ userId, email, role: 'owner', ip: null, userAgent: null, businessId });
  return { userId, email, token, key, db: scopedDb(e.DB, key), user, actor, env: { ...e, DB: scopedDb(e.DB, key) } as Env };
}
