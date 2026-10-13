import type { Env } from '../../../src/env';
import { demoEnv } from '../../../src/modules/demo/config';
import { type ResetResult, runReset } from '../../../src/modules/demo/reset';
import { ensureMasters } from '../../../src/modules/demo/sample';
import { slackNotifier } from '../../../src/modules/ita/notify';

/**
 * R26 task 9: open-ledger-sample-reset. A separate Worker with its own bindings to the sample
 * Ledger's D1 and files bucket. At 03:00 Israel time it removes every visitor sandbox
 * (src/modules/demo/reset.ts), then loads the master sample set if it is missing or older than
 * demo/seed/sample-set.json. POST /run does the same for the admin's "Reset sandboxes now",
 * with the shared secret in X-Reset-Secret. No API token.
 */

export interface ResetEnv extends Env {
  RESET_SECRET?: string;
}

/** The hour in Israel. The cron fires at 00:00 and 01:00 UTC and runs only when it is 03:00 there. */
export function israelHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false }).format(now)) % 24;
}

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length === 0 || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

export async function resetNow(env: ResetEnv, trigger: 'cron' | 'admin', fetchFn: typeof fetch = (i, init) => fetch(i, init)): Promise<ResetResult & { mastersLoaded: boolean }> {
  const notifier = slackNotifier(env.SLACK_WEBHOOK_URL, fetchFn);
  const result = await runReset({ db: env.DB, files: env.FILES, trigger, notifier });
  let mastersLoaded = false;
  if (result.ok) mastersLoaded = (await ensureMasters({ env: { ...demoEnv({ ...env, DEMO_MODE: '1' }), DEMO_MODE: '1' } as Env })).loaded;
  return { ...result, mastersLoaded };
}

export default {
  async scheduled(controller: ScheduledController, env: ResetEnv, ctx: ExecutionContext) {
    if (israelHour(new Date(controller.scheduledTime)) !== 3) return;
    ctx.waitUntil(resetNow(env, 'cron'));
  },
  async fetch(request: Request, env: ResetEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/run') return new Response('Not found', { status: 404 });
    if (!env.RESET_SECRET || !sameSecret(request.headers.get('X-Reset-Secret') ?? '', env.RESET_SECRET)) {
      return Response.json({ ok: false, message: 'Not allowed.' }, { status: 401 });
    }
    return Response.json(await resetNow(env, 'admin'));
  },
} satisfies ExportedHandler<ResetEnv>;
