import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { first, run } from '../../../src/core/db';
import { ACCESS_EXPIRY_CRON, accessModule, signDownloadUrl } from '../../../src/modules/access';

function controller(cron: string): ScheduledController {
  return { cron, scheduledTime: Date.now(), noRetry: () => {} } as unknown as ScheduledController;
}

describe('accessModule.scheduled', () => {
  it('runs the expiry check only for its own cron string', async () => {
    await run(env.DB, `INSERT INTO users (email, role, active, access_ends_on) VALUES ('cron-test@example.com', 'accountant', 1, '2000-01-01')`);

    await accessModule.scheduled!(controller('*/15 * * * *'), env, {} as ExecutionContext);
    expect((await first<{ active: number }>(env.DB, `SELECT active FROM users WHERE email = 'cron-test@example.com'`))?.active).toBe(1);

    await accessModule.scheduled!(controller(ACCESS_EXPIRY_CRON), env, {} as ExecutionContext);
    expect((await first<{ active: number }>(env.DB, `SELECT active FROM users WHERE email = 'cron-test@example.com'`))?.active).toBe(0);
  });
});

describe('signDownloadUrl (config)', () => {
  it('refuses to sign without DOWNLOAD_SIGN_KEY', async () => {
    await expect(signDownloadUrl({ ...env, DOWNLOAD_SIGN_KEY: undefined }, 'k', 'expenses')).rejects.toThrow(
      'DOWNLOAD_SIGN_KEY',
    );
  });
});
