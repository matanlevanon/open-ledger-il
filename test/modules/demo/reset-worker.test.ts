import { describe, expect, it } from 'vitest';
import worker, { israelHour, type ResetEnv } from '../../../tools/demo-reset/src/index';
import { demoTestEnv } from './helpers';

/** R26 task 9: the reset Worker's door. POST /run with the shared secret, 03:00 Israel time only. */
const env = { ...demoTestEnv(), RESET_SECRET: 'reset-secret-value' } as ResetEnv;

describe('open-ledger-sample-reset', () => {
  it('refuses /run without the shared secret, and anything else', async () => {
    expect((await worker.fetch(new Request('https://reset.test/run', { method: 'POST' }), env)).status).toBe(401);
    expect((await worker.fetch(new Request('https://reset.test/run', { method: 'POST', headers: { 'X-Reset-Secret': 'wrong' } }), env)).status).toBe(401);
    expect((await worker.fetch(new Request('https://reset.test/run', { method: 'POST', headers: { 'X-Reset-Secret': 'x' } }), { ...env, RESET_SECRET: '' })).status).toBe(401);
    expect((await worker.fetch(new Request('https://reset.test/'), env)).status).toBe(404);
  });

  it('runs the reset and loads the masters with the secret', async () => {
    const res = await worker.fetch(new Request('https://reset.test/run', { method: 'POST', headers: { 'X-Reset-Secret': 'reset-secret-value' } }), env);
    const body = (await res.json()) as { ok: boolean; mastersLoaded: boolean };
    expect(body.ok).toBe(true);
    expect(body.mastersLoaded).toBe(true);
  }, 120_000);

  it('the cron runs at 03:00 Israel time, summer and winter', () => {
    expect(israelHour(new Date('2026-07-01T00:00:00Z'))).toBe(3);
    expect(israelHour(new Date('2026-07-01T01:00:00Z'))).toBe(4);
    expect(israelHour(new Date('2026-12-01T01:00:00Z'))).toBe(3);
    expect(israelHour(new Date('2026-12-01T00:00:00Z'))).toBe(2);
  });
});
