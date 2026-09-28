import { SYSTEM_ACTOR, auditAs } from '../../core/audit';
import { all, assertDate, run } from '../../core/db';
import type { AccessNotifier } from './notifier';

interface AccountantRow {
  id: number;
  email: string;
  name: string | null;
  access_ends_on: string;
}

/** `date` plus `days` calendar days, as YYYY-MM-DD. Whole-day arithmetic, no timezone. */
export function addDays(date: string, days: number): string {
  assertDate(date);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Runs on the daily cron (`0 8 * * *`). Two independent checks against `today`:
 *   - an accountant whose access ends in exactly 14 days gets one Slack reminder
 *   - an accountant whose end date has arrived is disabled at once
 * Both write to `audit_log`. Idempotent: an already-disabled row never fires twice.
 */
export async function runAccessExpiryCheck(db: D1Database, notifier: AccessNotifier, today: string): Promise<void> {
  assertDate(today);
  const reminderDate = addDays(today, 14);

  const reminders = await all<AccountantRow>(
    db,
    `SELECT id, email, name, access_ends_on FROM users
     WHERE role = 'accountant' AND active = 1 AND access_ends_on = ?`,
    reminderDate,
  );
  for (const u of reminders) {
    await notifier.remind({ email: u.email, name: u.name, accessEndsOn: u.access_ends_on });
    await auditAs(db, SYSTEM_ACTOR, 'user.access_reminder', 'user', u.email, { accessEndsOn: u.access_ends_on });
  }

  const expired = await all<AccountantRow>(
    db,
    `SELECT id, email, name, access_ends_on FROM users
     WHERE role = 'accountant' AND active = 1 AND access_ends_on IS NOT NULL AND access_ends_on <= ?`,
    today,
  );
  for (const u of expired) {
    await run(db, `UPDATE users SET active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`, u.id);
    await auditAs(db, SYSTEM_ACTOR, 'user.access_expired', 'user', u.email, { accessEndsOn: u.access_ends_on });
  }
}
