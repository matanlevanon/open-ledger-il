import type { D1Migration } from 'cloudflare:test';
import type { Env as WorkerEnv } from '../src/env';

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import('../src/index');
    }
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
      /** Test-only scratch D1, declared in vitest.config.ts, never in wrangler.toml or WorkerEnv. */
      SCRATCH_DB: D1Database;
    }
  }
}
