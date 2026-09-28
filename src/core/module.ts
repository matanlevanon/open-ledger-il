import type { Hono } from 'hono';
import type { AppEnv, Env } from '../env';

/**
 * A feature module. Each run exports one from `src/modules/<name>/index.ts` and registers it
 * with one line in `src/modules/index.ts`.
 */
export interface ModuleDef {
  /** Folder name, for example "documents". */
  name: string;
  /** Mount path under /api, for example "/documents". */
  basePath: string;
  /** Routes. Every route declares its feature with `requireFeature` or `requireRole`. */
  routes: Hono<AppEnv>;
  /**
   * Cron expressions this module handles. Each one must also be listed in wrangler.toml's
   * `[triggers] crons`. `src/scheduled.ts` calls `scheduled` only for these.
   */
  crons?: readonly string[];
  /** Cron handler. Called once per matching entry in `crons`, with `controller.cron` set. */
  scheduled?: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => Promise<void>;
}
