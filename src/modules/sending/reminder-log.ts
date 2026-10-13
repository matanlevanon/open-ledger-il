import { all, first, run } from '../../core/db';

/**
 * R28: reminder_log, one append-only row per automatic reminder. An email sent or failed, a
 * WhatsApp reminder due (email cannot go), or a due WhatsApp reminder the owner shared. The cron
 * dedupes on (target, rule): a rule fires once, whatever the channel.
 */

export type ReminderTarget = 'document' | 'contract';
export type ReminderChannel = 'email' | 'whatsapp_due';
export type ReminderResult = 'sent' | 'failed' | 'due' | 'shared';

export interface ReminderLogInput {
  businessId: number;
  clientId: number;
  targetKind: ReminderTarget;
  targetId: number;
  channel: ReminderChannel;
  rule: string;
  result: ReminderResult;
  details?: Record<string, unknown> | null;
  at?: string;
}

export async function logReminder(db: D1Database, r: ReminderLogInput): Promise<void> {
  await run(
    db,
    `INSERT INTO reminder_log (business_id, client_id, target_kind, target_id, channel, rule, result, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`,
    r.businessId,
    r.clientId,
    r.targetKind,
    r.targetId,
    r.channel,
    r.rule,
    r.result,
    r.details ? JSON.stringify(r.details) : null,
    r.at ?? null,
  );
}

/** True once a rule fired for this target, by email or as a WhatsApp reminder due. */
export async function ruleFired(db: D1Database, kind: ReminderTarget, id: number, rule: string): Promise<boolean> {
  const row = await first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM reminder_log WHERE target_kind = ? AND target_id = ? AND rule = ? AND result IN ('sent', 'due')", kind, id, rule);
  return (row?.n ?? 0) > 0;
}

/** Automatic reminders are on for this client unless the owner turned them off. */
export async function clientAutoReminders(db: D1Database, clientId: number): Promise<boolean> {
  const row = await first<{ auto_reminders: number }>(db, 'SELECT auto_reminders FROM clients WHERE id = ?', clientId);
  return row?.auto_reminders !== 0;
}

export interface ReminderLogRow {
  id: number;
  client_id: number;
  target_kind: ReminderTarget;
  target_id: number;
  channel: ReminderChannel;
  rule: string;
  result: ReminderResult;
  details: string | null;
  created_at: string;
}

export interface ReminderLogView {
  id: number;
  targetKind: ReminderTarget;
  targetId: number;
  channel: ReminderChannel;
  rule: string;
  result: ReminderResult;
  label: string | null;
  at: string;
}

const toView = (r: ReminderLogRow): ReminderLogView => {
  const d = r.details ? (JSON.parse(r.details) as { label?: string }) : {};
  return { id: r.id, targetKind: r.target_kind, targetId: r.target_id, channel: r.channel, rule: r.rule, result: r.result, label: d.label ?? null, at: r.created_at };
};

/** The client page Reminders list, newest first. */
export async function clientReminders(db: D1Database, businessId: number, clientId: number, limit = 100): Promise<ReminderLogView[]> {
  const rows = await all<ReminderLogRow>(db, 'SELECT * FROM reminder_log WHERE business_id = ? AND client_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', businessId, clientId, limit);
  return rows.map(toView);
}
