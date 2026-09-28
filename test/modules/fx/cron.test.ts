import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { all, run } from '../../../src/core/db';
import { FX_DAILY_CRON, fxScheduled } from '../../../src/modules/fx/cron';
import { FakeFxProvider } from '../../../src/modules/fx/provider';
import type { FxRateRow } from '../../../src/modules/fx/rates';
import { FIXTURE_RATES, FRIDAY } from '../../fixtures/fx/rates';

function controller(cron: string, at = new Date(`${FRIDAY}T06:00:00Z`)): ScheduledController {
  return { cron, scheduledTime: at.getTime(), noRetry: () => {} } as ScheduledController;
}

// Storage is isolated per test file, not per test, so each test clears the cache it shares.
beforeEach(async () => {
  await run(env.DB, 'DELETE FROM fx_rates');
});

describe('fx: daily cron prefetch', () => {
  it('caches USD, EUR and GBP on its own cron', async () => {
    const provider = new FakeFxProvider(FIXTURE_RATES);
    await fxScheduled(controller(FX_DAILY_CRON), env, undefined, provider);
    const rows = await all<FxRateRow>(env.DB, `SELECT * FROM fx_rates WHERE source = 'boi' ORDER BY currency`);
    expect(rows.map((r) => r.currency)).toEqual(['EUR', 'GBP', 'USD']);
    expect(rows.find((r) => r.currency === 'USD')?.rate).toBe('3.712000');
  });

  it('ignores a cron trigger that is not its own', async () => {
    const provider = new FakeFxProvider(FIXTURE_RATES);
    await fxScheduled(controller('*/15 * * * *'), env, undefined, provider);
    const rows = await all(env.DB, `SELECT * FROM fx_rates`);
    expect(rows).toHaveLength(0);
  });

  it('caches the currencies that succeed even when one fails', async () => {
    const provider = new FakeFxProvider({
      USD: FIXTURE_RATES.USD,
      EUR: FIXTURE_RATES.EUR,
      // GBP has no fixture: FakeFxProvider throws for it.
    });
    await fxScheduled(controller(FX_DAILY_CRON), env, undefined, provider);
    const rows = await all<FxRateRow>(env.DB, `SELECT * FROM fx_rates WHERE source = 'boi'`);
    expect(rows.map((r) => r.currency).sort()).toEqual(['EUR', 'USD']);
  });
});
