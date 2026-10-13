import type { Env } from '../../../src/env';
import { demoEnv } from '../../../src/modules/demo/config';
import { type ResetResult, runReset, runSweep, type SweepResult } from '../../../src/modules/demo/reset';
import { ensureMasters } from '../../../src/modules/demo/sample';
import { slackNotifier } from '../../../src/modules/ita/notify';

/**
 * R26, R29: open-ledger-sample-reset. A separate Worker with its own bindings to the sample
 * Ledger's D1 and files bucket. One cron, every 15 minutes:
 *   - every run sweeps expired visitor sessions and everything tagged with them
 *   - the first run at 03:00 Israel time also runs the nightly reset (src/modules/demo/reset.ts),
 *     then builds the sample set if it is missing, older than the seed, or changed
 * POST /run does the reset and the build at once, for the admin's "Reset now", with the shared
 * secret in X-Reset-Secret. No API token.
 */

export interface ResetEnv extends Env {
  RESET_SECRET?: string;
}

/** The hour in Israel. */
export function israelHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false }).format(now)) % 24;
}

const israelDay = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

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

/** True when tonight's reset has not run yet: 03:00 in Israel and no cron reset logged today. */
export async function resetDue(db: D1Database, now: Date): Promise<boolean> {
  if (israelHour(now) !== 3) return false;
  const last = await db.prepare("SELECT started_at FROM demo_resets WHERE trigger_by = 'cron' ORDER BY id DESC LIMIT 1").first<{ started_at: string }>();
  return !last || israelDay(new Date(last.started_at)) !== israelDay(now);
}

/** One cron run: the sweep, then the nightly reset when it is due. */
export async function onCron(env: ResetEnv, now: Date, fetchFn?: typeof fetch): Promise<{ sweep: SweepResult; reset: (ResetResult & { mastersLoaded: boolean }) | null }> {
  const sweep = await runSweep({ db: env.DB, files: env.FILES, notifier: slackNotifier(env.SLACK_WEBHOOK_URL, fetchFn ?? ((i, init) => fetch(i, init))), now });
  const reset = (await resetDue(env.DB, now)) ? await resetNow(env, 'cron', fetchFn) : null;
  return { sweep, reset };
}

export default {
  async scheduled(controller: ScheduledController, env: ResetEnv, ctx: ExecutionContext) {
    ctx.waitUntil(onCron(env, new Date(controller.scheduledTime)));
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
