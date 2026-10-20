import { describe, expect, it } from 'vitest';
import { first } from '../../../src/core/db';
import worker, { israelHour, onCron, resetDue, type ResetEnv } from '../../../tools/demo-reset/src/index';
import { demoTestEnv } from './helpers';

/** R26 task 9, R29 task 5: the reset Worker. POST /run with the shared secret. One cron: the sweep every run, the reset at 03:00 Israel time once a night. */
const env = { ...demoTestEnv(), RESET_SECRET: 'reset-secret-value' } as ResetEnv;
const fakeFetch: typeof fetch = async () => new Response('ok');

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

  it('israelHour reads summer and winter time', () => {
    expect(israelHour(new Date('2026-07-01T00:00:00Z'))).toBe(3);
    expect(israelHour(new Date('2026-07-01T01:00:00Z'))).toBe(4);
    expect(israelHour(new Date('2026-12-01T01:00:00Z'))).toBe(3);
    expect(israelHour(new Date('2026-12-01T00:00:00Z'))).toBe(2);
  });

  it('every cron run sweeps, and the first run of the 03:00 hour also resets, once a night', async () => {
    const before = (await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM demo_sweeps'))!.n;
    const noon = await onCron(env, new Date('2026-10-13T09:00:00Z'), fakeFetch);
    expect(noon.reset).toBeNull();
    expect((await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM demo_sweeps'))!.n).toBe(before + 1);
    // 03:00 in Israel on 14 Oct 2026 is 00:00 UTC (summer time).
    const night = new Date('2026-10-14T00:00:00Z');
    expect(await resetDue(env.DB, night)).toBe(true);
    const first03 = await onCron(env, night, fakeFetch);
    expect(first03.reset?.ok).toBe(true);
    // Rows log the real time, so the second run in the same hour is checked against a cron row for that night.
    await env.DB.prepare("UPDATE demo_resets SET started_at = ? WHERE id = (SELECT MAX(id) FROM demo_resets WHERE trigger_by = 'cron')").bind(night.toISOString()).run();
    expect(await resetDue(env.DB, new Date('2026-10-14T00:15:00Z'))).toBe(false);
    expect((await onCron(env, new Date('2026-10-14T00:15:00Z'), fakeFetch)).reset).toBeNull();
  }, 120_000);

  it('R43: a cron run builds a missing sample set, so a visitor request never has to', async () => {
    await env.DB.prepare('DELETE FROM demo_master_businesses').run();
    await onCron(env, new Date('2026-10-13T10:00:00Z'), fakeFetch);
    expect((await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM demo_master_businesses'))!.n).toBe(2);
  }, 180_000);
});
