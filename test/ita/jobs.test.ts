import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { AuditActor } from '../../src/core/audit';
import { first } from '../../src/core/db';
import { ITA_PATHS } from '../../src/modules/ita/config';
import { createItaModule } from '../../src/modules/ita';
import { RELOGIN_REMINDER_DAY, runRetryQueue, runTokenCheck } from '../../src/modules/ita/jobs';
import { setupIta } from './helpers';

const OWNER: AuditActor = { userId: null, email: 'owner@example.com', role: 'owner', ip: null, userAgent: null };
const MIN = 60_000;
const DAY = 86_400_000;

async function allocation(documentId: number) {
  return first<Record<string, unknown>>(env.DB, 'SELECT * FROM ita_allocations WHERE document_id = ?', documentId);
}

describe('allocation rule: retry queue every 15 minutes for 24 hours', () => {
  it('retries due documents in one MultiApproval call once the ITA is back', async () => {
    const ctx = await setupIta({ start: '2027-03-02T08:00:00.000Z' });
    const a = await ctx.addInvoice({ date: '2027-03-01' });
    const b = await ctx.addInvoice({ date: '2027-03-01' });
    ctx.mock.forceNext(500);
    ctx.mock.forceNext(502);
    await ctx.service.request(a.id, OWNER);
    await ctx.service.request(b.id, OWNER);

    // Not due yet.
    ctx.clock.advance(10 * MIN);
    expect((await runRetryQueue(ctx.env, ctx.deps)).retried).toBe(0);

    ctx.clock.advance(6 * MIN);
    const run = await runRetryQueue(ctx.env, ctx.deps);
    expect(run).toMatchObject({ retried: 2, approved: 2 });
    expect(ctx.mock.apiCalls(ITA_PATHS.multiApproval)).toHaveLength(1);
    expect(ctx.docs.docs.get(a.id)?.status).toBe('final');
    expect(ctx.docs.docs.get(b.id)?.status).toBe('final');
  });

  it('keeps retrying while the ITA is down, then stops after 24 hours with one Slack alert', async () => {
    const ctx = await setupIta({ start: '2027-03-10T08:00:00.000Z' });
    const doc = await ctx.addInvoice({ date: '2027-03-09' });
    await ctx.service.tokens.accessToken();
    ctx.mock.down = true;
    await ctx.service.request(doc.id, OWNER);

    let ticks = 0;
    for (let t = 15; t < 24 * 60; t += 15) {
      ctx.clock.advance(15 * MIN);
      await runRetryQueue(ctx.env, ctx.deps);
      ticks++;
    }
    const row = (await allocation(doc.id))!;
    expect(row.status).toBe('pending');
    expect(Number(row.attempts)).toBe(ticks + 1);
    expect(ctx.notifier.messages).toHaveLength(0);

    ctx.clock.advance(15 * MIN);
    const last = await runRetryQueue(ctx.env, ctx.deps);
    expect(last).toMatchObject({ stalled: 1, alerts: 1, retried: 0 });
    expect((await allocation(doc.id))?.status).toBe('stalled');
    expect(ctx.notifier.messages[0]).toContain(`document ${doc.id}`);
    expect(ctx.notifier.messages[0]).toContain('https://secapp.taxes.gov.il/em-hkz-hsb-intr');

    // No second alert, no more retries.
    ctx.clock.advance(15 * MIN);
    expect(await runRetryQueue(ctx.env, ctx.deps)).toMatchObject({ stalled: 0, alerts: 0, retried: 0 });
    expect(ctx.notifier.messages).toHaveLength(1);

    // The owner types in the number from the web app.
    ctx.mock.down = false;
    const manual = await ctx.service.enterManual(doc.id, '202703110000001234567890', 'ITA web app', OWNER);
    expect(manual.status).toBe('approved');
    }, 30_000); // 96 queue runs, slow on a busy machine

  it('retries the alert when Slack did not take it', async () => {
    const ctx = await setupIta({ start: '2027-03-15T08:00:00.000Z' });
    const doc = await ctx.addInvoice({ date: '2027-03-14' });
    ctx.mock.forceNext(500);
    await ctx.service.request(doc.id, OWNER);
    ctx.mock.down = true;
    ctx.notifier.ok = false;
    ctx.clock.advance(25 * 60 * MIN);
    expect(await runRetryQueue(ctx.env, ctx.deps)).toMatchObject({ stalled: 1, alerts: 0 });
    ctx.notifier.ok = true;
    ctx.clock.advance(15 * MIN);
    expect(await runRetryQueue(ctx.env, ctx.deps)).toMatchObject({ alerts: 1 });
  });

  it('the module cron handler runs the queue on its schedule only', async () => {
    const ctx = await setupIta({ start: '2027-03-20T08:00:00.000Z' });
    const doc = await ctx.addInvoice({ date: '2027-03-19' });
    ctx.mock.forceNext(500);
    await ctx.service.request(doc.id, OWNER);
    ctx.clock.advance(16 * MIN);
    const module = createItaModule(ctx.deps);
    const controller = (cron: string) => ({ cron, scheduledTime: 0, type: 'scheduled', noRetry() {} }) as unknown as ScheduledController;
    await module.scheduled!(controller('0 6 * * *'), ctx.env, {} as ExecutionContext);
    expect(ctx.docs.docs.get(doc.id)?.status).toBe('allocation_pending');
    await module.scheduled!(controller('*/15 * * * *'), ctx.env, {} as ExecutionContext);
    expect(ctx.docs.docs.get(doc.id)?.status).toBe('final');
  });
});

describe('token check and the day-75 reminder', () => {
  it('never renews the login, and sends one reminder from day 75', async () => {
    const ctx = await setupIta();
    ctx.clock.advance((RELOGIN_REMINDER_DAY - 1) * DAY);
    expect(await runTokenCheck(ctx.env, ctx.deps)).toEqual({ status: 'active', refreshed: false, reminded: false });
    ctx.clock.advance(DAY);
    expect(await runTokenCheck(ctx.env, ctx.deps)).toEqual({ status: 'active', refreshed: false, reminded: true });
    expect(ctx.notifier.messages[0]).toContain('ends in 15 days');
    ctx.clock.advance(DAY);
    expect((await runTokenCheck(ctx.env, ctx.deps)).reminded).toBe(false);
    expect(ctx.notifier.messages).toHaveLength(1);
    const status = await ctx.service.tokens.status();
    expect(status).toMatchObject({ days_since_login: 76, days_until_relogin: 14 });
  });

  it('a new login resets the reminder', async () => {
    const ctx = await setupIta();
    ctx.clock.advance(RELOGIN_REMINDER_DAY * DAY);
    await runTokenCheck(ctx.env, ctx.deps);
    await ctx.service.tokens.exchangeCode(ctx.mock.issueCode(), 'https://x/cb', null);
    expect(await ctx.service.tokens.status()).toMatchObject({ days_since_login: 0, reminder_sent_at: null });
  });

  it('marks the login for reconnecting on day 90 and raises a Slack alert', async () => {
    const ctx = await setupIta();
    ctx.clock.advance(90 * DAY);
    expect(await runTokenCheck(ctx.env, ctx.deps)).toMatchObject({ status: 'reconnect_required', refreshed: false });
    expect(ctx.notifier.messages.at(-1)).toContain('expired');
  });
});
