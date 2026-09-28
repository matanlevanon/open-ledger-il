import type { ModuleDef } from './core/module';
import type { Env } from './env';

/**
 * The Worker's one scheduled handler. wrangler.toml lists every cron in one `[triggers]` block,
 * and each fire lands here. The dispatcher runs every module that declares that cron in
 * `ModuleDef.crons`. One job failing does not stop the others. Failures are logged by name and
 * message only, never with secrets or request data.
 */
export interface CronJobResult {
  module: string;
  ok: boolean;
  error?: string;
}

/** Every cron the registered modules declare. Must equal wrangler.toml's `[triggers] crons`. */
export function declaredCrons(modules: readonly ModuleDef[]): string[] {
  return [...new Set(modules.flatMap((m) => m.crons ?? []))].sort();
}

export async function dispatchScheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
  modules: readonly ModuleDef[],
): Promise<CronJobResult[]> {
  const due = modules.filter((m) => m.scheduled && m.crons?.includes(controller.cron));
  if (due.length === 0) {
    console.error('cron.no_handler', controller.cron);
    return [];
  }
  const settled = await Promise.allSettled(due.map((m) => m.scheduled!(controller, env, ctx)));
  return settled.map((result, i) => {
    const module = due[i]!.name;
    if (result.status === 'fulfilled') return { module, ok: true };
    const error = result.reason instanceof Error ? `${result.reason.name}: ${result.reason.message}` : 'unknown';
    console.error('cron.job_failed', controller.cron, module, error);
    return { module, ok: false, error };
  });
}
