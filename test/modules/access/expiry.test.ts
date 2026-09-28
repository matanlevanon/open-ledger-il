import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { first, run } from '../../../src/core/db';
import { addDays, runAccessExpiryCheck } from '../../../src/modules/access/expiry';
import { FakeAccessNotifier } from '../../../src/modules/access/notifier';

const TODAY = '2026-10-01';

async function makeAccountant(email: string, accessEndsOn: string, active = 1) {
  const { lastRowId } = await run(
    env.DB,
    `INSERT INTO users (email, role, active, access_ends_on) VALUES (?, 'accountant', ?, ?)`,
    email,
    active,
    accessEndsOn,
  );
  return lastRowId;
}

describe('addDays', () => {
  it('adds whole calendar days, crossing month and year boundaries', () => {
    expect(addDays('2026-10-01', 14)).toBe('2026-10-15');
    expect(addDays('2026-01-20', 14)).toBe('2026-02-03');
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08');
  });
});

describe('runAccessExpiryCheck', () => {
  let notifier: FakeAccessNotifier;

  beforeEach(() => {
    notifier = new FakeAccessNotifier();
  });

  it('reminds exactly the accountants ending in 14 days, and only once each', async () => {
    await makeAccountant('due-soon@example.com', addDays(TODAY, 14));
    await makeAccountant('due-later@example.com', addDays(TODAY, 15));
    await makeAccountant('due-sooner@example.com', addDays(TODAY, 13));

    await runAccessExpiryCheck(env.DB, notifier, TODAY);

    expect(notifier.reminders.map((r) => r.email)).toEqual(['due-soon@example.com']);
    const log = await first<{ action: string }>(
      env.DB,
      `SELECT action FROM audit_log WHERE action = 'user.access_reminder' AND entity_id = 'due-soon@example.com'`,
    );
    expect(log?.action).toBe('user.access_reminder');
  });

  it('disables an accountant whose end date has arrived or passed, and leaves others alone', async () => {
    const pastId = await makeAccountant('expired@example.com', '2026-09-15');
    const todayId = await makeAccountant('ends-today@example.com', TODAY);
    const futureId = await makeAccountant('still-good@example.com', addDays(TODAY, 30));

    await runAccessExpiryCheck(env.DB, notifier, TODAY);

    expect((await first<{ active: number }>(env.DB, 'SELECT active FROM users WHERE id = ?', pastId))?.active).toBe(0);
    expect((await first<{ active: number }>(env.DB, 'SELECT active FROM users WHERE id = ?', todayId))?.active).toBe(0);
    expect((await first<{ active: number }>(env.DB, 'SELECT active FROM users WHERE id = ?', futureId))?.active).toBe(1);

    const log = await first<{ action: string }>(
      env.DB,
      `SELECT action FROM audit_log WHERE action = 'user.access_expired' AND entity_id = 'expired@example.com'`,
    );
    expect(log?.action).toBe('user.access_expired');
  });

  it('never touches an accountant already disabled', async () => {
    await makeAccountant('already-off@example.com', '2026-01-01', 0);
    await runAccessExpiryCheck(env.DB, notifier, TODAY);
    const log = await first(
      env.DB,
      `SELECT 1 FROM audit_log WHERE action = 'user.access_expired' AND entity_id = 'already-off@example.com'`,
    );
    expect(log).toBeNull();
  });

  it('never disables the owner, whatever access_ends_on says', async () => {
    await run(env.DB, `INSERT INTO users (email, role, access_ends_on) VALUES ('boss@example.com', 'owner', '2020-01-01')`);
    await runAccessExpiryCheck(env.DB, notifier, TODAY);
    expect((await first<{ active: number }>(env.DB, `SELECT active FROM users WHERE email = 'boss@example.com'`))?.active).toBe(
      1,
    );
  });
});
