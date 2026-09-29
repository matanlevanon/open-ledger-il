import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { all } from '../../../src/core/db';
import { GAP_CHECK_CRON, opsGapScheduled } from '../../../src/modules/ops';
import type { Notifier } from '../../../src/modules/ita/notify';

function controller(cron: string): ScheduledController {
  return { cron, scheduledTime: Date.now(), noRetry() {} } as unknown as ScheduledController;
}

class RecordingNotifier implements Notifier {
  sent: string[] = [];
  async send(text: string) {
    this.sent.push(text);
    return true;
  }
}

describe('opsGapScheduled (runs/R14-ops.md: Slack alert on any gap or hash-chain break)', () => {
  it('ignores a cron fire that is not its own', async () => {
    const notifier = new RecordingNotifier();
    await opsGapScheduled(controller('0 0 0 0 0'), env, undefined, { notifier, check: async () => ({ ok: false, series: [], chain: { ok: false, checked: 0, allocationsChecked: 0, headHash: '', breaks: [] } }) });
    expect(notifier.sent).toEqual([]);
  });

  it('stays quiet and logs ok when the check passes', async () => {
    const notifier = new RecordingNotifier();
    await opsGapScheduled(controller(GAP_CHECK_CRON), env, undefined, {
      notifier,
      check: async () => ({ ok: true, series: [], chain: { ok: true, checked: 3, allocationsChecked: 0, headHash: 'x', breaks: [] } }),
    });
    expect(notifier.sent).toEqual([]);
    const rows = await all(env.DB, "SELECT * FROM audit_log WHERE action = 'ops.gap_check' ORDER BY id DESC LIMIT 1");
    expect(JSON.parse((rows[0] as { details: string }).details).ok).toBe(true);
  });

  it('alerts Slack and logs failure when a series has a problem', async () => {
    const notifier = new RecordingNotifier();
    await opsGapScheduled(controller(GAP_CHECK_CRON), env, undefined, {
      notifier,
      check: async () => ({
        ok: false,
        series: [{ seriesId: 'PR', docType: 'PR', ok: false, count: 3, problems: [2] }],
        chain: { ok: true, checked: 3, allocationsChecked: 0, headHash: 'x', breaks: [] },
      }),
    });
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toMatch(/PR/);
    const rows = await all(env.DB, "SELECT * FROM audit_log WHERE action = 'ops.gap_check' ORDER BY id DESC LIMIT 1");
    expect(JSON.parse((rows[0] as { details: string }).details).ok).toBe(false);
  });

  it('alerts Slack when the hash chain itself breaks, even with no series gap', async () => {
    const notifier = new RecordingNotifier();
    await opsGapScheduled(controller(GAP_CHECK_CRON), env, undefined, {
      notifier,
      check: async () => ({
        ok: false,
        series: [],
        chain: { ok: false, checked: 5, allocationsChecked: 0, headHash: 'x', breaks: [{ seq: 4, documentId: 9, reason: 'content_changed' }] },
      }),
    });
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toMatch(/chain/i);
  });
});

describe('quarterly backup on the nightly cron', () => {
  it('runs only on the first day of a quarter', async () => {
    const { isQuarterStart } = await import('../../../src/modules/ops');
    expect(isQuarterStart(Date.parse('2026-10-01T02:00:00Z'))).toBe(true);
    expect(isQuarterStart(Date.parse('2027-01-01T02:00:00Z'))).toBe(true);
    expect(isQuarterStart(Date.parse('2026-10-02T02:00:00Z'))).toBe(false);
    expect(isQuarterStart(Date.parse('2026-11-01T02:00:00Z'))).toBe(false);
  });
});

describe('monthly accountant pack on the daily cron', () => {
  it('runs only on the 5th', async () => {
    const { isPackDay } = await import('../../../src/modules/reports/cron');
    expect(isPackDay(Date.parse('2026-11-05T07:00:00Z'))).toBe(true);
    expect(isPackDay(Date.parse('2026-11-06T07:00:00Z'))).toBe(false);
  });
});
