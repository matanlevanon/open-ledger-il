import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { createApp } from '../../../src/index';
import { FakeFxHistory, FakeFxProvider, createFxModule } from '../../../src/modules/fx';
import { cacheRate } from '../../../src/modules/fx/rates';
import { FRIDAY } from '../../fixtures/fx/rates';

const history = new FakeFxHistory({ USD: { '2024-06-13': '3.712500', '2024-06-14': '3.720000' } });

function app() {
  return createApp({ modules: [createFxModule({ current: () => new FakeFxProvider({}), history: () => history })] });
}

// Default test bindings (vitest.config.ts) sign every request in as the owner via DEV_AUTH_EMAIL.
async function ownerRequest(path: string, init: RequestInit = {}) {
  return app().request(`/api${path}`, init, env);
}

async function accountantRequest(path: string, init: RequestInit = {}) {
  await run(env.DB, `INSERT OR IGNORE INTO users (email, role) VALUES ('cpa@example.com', 'accountant')`);
  return app().request(`/api${path}`, init, { ...env, DEV_AUTH_EMAIL: 'cpa@example.com' });
}

describe('fx routes: owner only', () => {
  it('lets the owner read a resolved rate', async () => {
    await cacheRate(env.DB, 'USD', { rate: '3.712000', rateDate: FRIDAY, source: 'boi' });
    const res = await ownerRequest(`/fx/rate?currency=USD&date=${FRIDAY}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rate: { rate: string } }).rate.rate).toBe('3.712000');
  });

  it('refuses an accountant: settings is owner only', async () => {
    const res = await accountantRequest(`/fx/rate?currency=USD&date=${FRIDAY}`);
    expect(res.status).toBe(403);
  });

  it('rejects an unsupported currency with a validation error, not a 500', async () => {
    const res = await ownerRequest(`/fx/rate?currency=XXX&date=${FRIDAY}`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('validation_error');
  });

  it('surfaces a date with no published rate as fx_unavailable, not a 500', async () => {
    const res = await ownerRequest(`/fx/rate?currency=EUR&date=2020-01-01`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('fx_unavailable');
  });
});

describe('fx routes: recent rates', () => {
  it('lists cached rates for a currency, newest first', async () => {
    await cacheRate(env.DB, 'GBP', { rate: '4.700000', rateDate: '2026-09-30', source: 'boi' });
    await cacheRate(env.DB, 'GBP', { rate: '4.705000', rateDate: FRIDAY, source: 'boi' });
    const res = await ownerRequest('/fx/rates?currency=GBP');
    const body = (await res.json()) as { rates: { rate_date: string }[] };
    expect(body.rates.map((r) => r.rate_date)).toEqual([FRIDAY, '2026-09-30']);
  });
});

describe('fx routes: historical backfill', () => {
  it('backfills a past range from the Bank of Israel series and resolves a date inside it', async () => {
    const res = await ownerRequest('/fx/rates/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: 'USD', from: '2024-06-10', to: '2024-06-16' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ currency: 'USD', from: '2024-06-10', to: '2024-06-16', cached: 2 });

    const rate = await ownerRequest('/fx/rate?currency=USD&date=2024-06-15');
    expect(((await rate.json()) as { rate: unknown }).rate).toMatchObject({ rate: '3.720000', rateDate: '2024-06-14', source: 'boi_fallback' });
  });

  it('refuses a range longer than one year', async () => {
    const res = await ownerRequest('/fx/rates/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: 'USD', from: '2020-01-01', to: '2024-01-01' }),
    });
    expect(res.status).toBe(400);
  });

  it('refuses an accountant', async () => {
    const res = await accountantRequest('/fx/rates/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: 'USD', from: '2024-06-10' }),
    });
    expect(res.status).toBe(403);
  });
});
