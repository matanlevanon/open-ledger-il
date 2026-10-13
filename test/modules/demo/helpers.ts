import { env } from 'cloudflare:workers';
import type { Env } from '../../../src/env';
import { demoEnv } from '../../../src/modules/demo/config';

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
