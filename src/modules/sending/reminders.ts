import { first, run } from '../../core/db';
import type { Env } from '../../env';
import { clientDisplayName } from '../clients/display';
import { openDemands } from '../documents/balances';
import { displayNumber } from '../documents/types';
import { isConsentGranted } from './consent';
import { logReminder, ruleFired } from './reminder-log';
import type { Mailer } from './mailer';
import { businessDisplayName, paymentLinkSettings, reminderSettings } from './settings';
import { listBusinessIds } from '../../core/business';
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
  /** R28: null when email is off. A reminder then shows on the dashboard as due on WhatsApp. */
  mailer: Mailer | null;
  today: string;
  /** R24: reminders run per business, under its own settings and sender name. */
  businessId: number;
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
 *
 * R28: a client with automatic reminders off is skipped. Every send is logged to reminder_log. A
 * client with a phone and no email, or any client while email is off, gets a WhatsApp reminder due
 * on the dashboard instead, once per rule.
 */
export async function runReminders(deps: ReminderDeps): Promise<ReminderRunResult> {
  const { db, mailer, today, businessId } = deps;
  const settings = await reminderSettings(db, businessId);
  let sent = 0;
  let skipped = 0;
  if (!settings.enabled) return { sent, skipped };

  const demands = (await openDemands(db, businessId)).filter((d) => d.due_date !== null && d.client_id !== null);
  const links = await paymentLinkSettings(db, businessId);
  const businessName = await businessDisplayName(db, businessId);

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
    const rule = `${direction}_${offset}`;

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
    const client = await first<{ email: string | null; phone: string | null; name_en: string | null; name_he: string | null; auto_reminders: number }>(
      db,
      'SELECT email, phone, name_en, name_he, auto_reminders FROM clients WHERE id = ?',
      demand.client_id,
    );
    if (!client || client.auto_reminders === 0) {
      skipped++;
      continue;
    }
    const docRow = await first<{ type: string; number: number | null }>(db, 'SELECT type, number FROM documents WHERE id = ?', demand.id);
    const number = docRow ? displayNumber(docRow.type, docRow.number) : null;
    const logBase = { businessId, clientId: demand.client_id!, targetKind: 'document' as const, targetId: demand.id, rule };
    if (!client.email || !mailer) {
      if (client.phone && !(await ruleFired(db, 'document', demand.id, rule))) {
        await logReminder(db, { ...logBase, channel: 'whatsapp_due', result: 'due', details: { label: number ?? 'Payment request', direction, days: offset } });
      }
      skipped++;
      continue;
    }
    const clientName = clientDisplayName(client, 'en');

    let status: 'sent' | 'failed' = 'sent';
    let providerMessageId: string | null = null;
    let failReason: string | null = null;
    try {
      const result = await mailer.send({
        to: client.email,
        subject: number ? `Reminder: ${number}` : 'Payment reminder',
        fromName: businessName,
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
    await logReminder(db, { ...logBase, channel: 'email', result: status, details: { label: number ?? 'Payment request', to: client.email, ...(failReason ? { error: failReason } : {}) } });
    if (status === 'sent') sent++;
    else skipped++;
  }

  return { sent, skipped };
}

export const REMINDERS_CRON = '0 7 * * *';

export async function runRemindersCron(env: Env, mailer: Mailer | null, today: string): Promise<ReminderRunResult> {
  const total: ReminderRunResult = { sent: 0, skipped: 0 };
  for (const businessId of await listBusinessIds(env.DB)) {
    const r = await runReminders({ db: env.DB, mailer, today, businessId });
    total.sent += r.sent;
    total.skipped += r.skipped;
  }
  return total;
}
