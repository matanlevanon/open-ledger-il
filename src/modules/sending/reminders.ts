import { first, run } from '../../core/db';
import type { Env } from '../../env';
import { clientDisplayName } from '../clients/display';
import { openDemands } from '../documents/balances';
import { displayNumber } from '../documents/types';
import { isConsentGranted } from './consent';
import type { Mailer } from './mailer';
import { businessDisplayName, paymentLinkSettings, reminderSettings } from './settings';
import { reminderEmailHtml, reminderEmailText } from './templates';

function toUtcDays(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86400000;
}

/** Whole days from `today` to `dueDate` (YYYY-MM-DD). Positive when `dueDate` is later. */
function daysUntil(today: string, dueDate: string): number {
  return Math.round(toUtcDays(dueDate) - toUtcDays(today));
}

export interface ReminderDeps {
  db: D1Database;
  mailer: Mailer;
  today: string;
}

export interface ReminderRunResult {
  sent: number;
  skipped: number;
}

/**
 * Cron-driven reminders (runs/R06-sending.md: "before and after due date, configurable"). Reads
 * open payment demands (PR, 300) from `openDemands` (R01) and matches each against the
 * configured day offsets. Deduplicated per (document, direction, offset) through `send_log.reason`,
 * so a reminder fires once even if the cron runs more than once on the same day.
 */
export async function runReminders(deps: ReminderDeps): Promise<ReminderRunResult> {
  const { db, mailer, today } = deps;
  const settings = await reminderSettings(db);
  let sent = 0;
  let skipped = 0;
  if (!settings.enabled) return { sent, skipped };

  const demands = (await openDemands(db)).filter((d) => d.due_date !== null && d.client_id !== null);
  const links = await paymentLinkSettings(db);
  const businessName = await businessDisplayName(db);

  for (const demand of demands) {
    const delta = daysUntil(today, demand.due_date!);
    const direction: 'before' | 'after' | null = settings.beforeDays.includes(delta)
      ? 'before'
      : settings.afterDays.includes(-delta)
        ? 'after'
        : null;
    if (direction === null) continue;

    const offset = direction === 'before' ? delta : -delta;
    const reason = `days=${offset}`;
    const channel = direction === 'before' ? 'reminder_before' : 'reminder_after';

    const already = await first<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM send_log WHERE document_id = ? AND channel = ? AND reason = ?`,
      demand.id,
      channel,
      reason,
    );
    if ((already?.n ?? 0) > 0) {
      skipped++;
      continue;
    }

    if (!(await isConsentGranted(db, demand.client_id!))) {
      skipped++;
      continue;
    }
    const client = await first<{ email: string | null; name_en: string | null; name_he: string | null }>(
      db,
      'SELECT email, name_en, name_he FROM clients WHERE id = ?',
      demand.client_id,
    );
    if (!client?.email) {
      skipped++;
      continue;
    }
    const docRow = await first<{ type: string; number: number | null }>(db, 'SELECT type, number FROM documents WHERE id = ?', demand.id);
    const number = docRow ? displayNumber(docRow.type, docRow.number) : null;
    const clientName = clientDisplayName(client, 'en');

    let status: 'sent' | 'failed' = 'sent';
    let providerMessageId: string | null = null;
    let failReason: string | null = null;
    try {
      const result = await mailer.send({
        to: client.email,
        subject: number ? `Reminder: ${number}` : 'Payment reminder',
        html: reminderEmailHtml(clientName, number, direction, links, businessName),
        text: reminderEmailText(clientName, number, direction, links, businessName),
      });
      providerMessageId = result.id;
    } catch (err) {
      status = 'failed';
      failReason = err instanceof Error ? err.message : String(err);
    }

    await run(
      db,
      `INSERT INTO send_log (document_id, client_id, channel, to_address, status, reason, provider_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      demand.id,
      demand.client_id,
      channel,
      client.email,
      status,
      status === 'sent' ? reason : failReason,
      providerMessageId,
    );
    if (status === 'sent') sent++;
    else skipped++;
  }

  return { sent, skipped };
}

export const REMINDERS_CRON = '0 7 * * *';

export async function runRemindersCron(env: Env, mailer: Mailer, today: string): Promise<ReminderRunResult> {
  return runReminders({ db: env.DB, mailer, today });
}
