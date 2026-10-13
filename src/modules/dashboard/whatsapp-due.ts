import type { AuditActor } from '../../core/audit';
import { all, first } from '../../core/db';
import { ConflictError, NotFoundError } from '../../core/errors';
import type { Env } from '../../env';
import { clientDisplayName } from '../clients/display';
import { remindContract, whatsappUrl } from '../contracts/service';
import { displayNumber } from '../documents/types';
import { logReminder, type ReminderLogRow } from '../sending/reminder-log';
import { paymentLinkSettings } from '../sending/settings';
import { senderName } from '../sending/share-page';
import { reminderEmailText } from '../sending/templates';

/**
 * R28: reminders the 07:00 run could not email (the client has a phone and no email, or email is
 * off) show on the dashboard as due on WhatsApp today. Share on WhatsApp opens the prefilled
 * message and logs it as shared, so the item leaves the list.
 */

export interface WhatsAppDue {
  /** The newest due row of this target, the id Share sends back. */
  id: number;
  clientId: number;
  clientName: string;
  targetKind: 'document' | 'contract';
  targetId: number;
  label: string;
  rules: string[];
  phone: string | null;
}

type DueRow = ReminderLogRow & { name_en: string | null; name_he: string | null; phone: string | null };

async function dueRows(db: D1Database, businessId: number, today: string, where = '', ...params: (string | number)[]): Promise<DueRow[]> {
  return all<DueRow>(
    db,
    `SELECT r.*, c.name_en, c.name_he, c.phone FROM reminder_log r JOIN clients c ON c.id = r.client_id
     WHERE r.business_id = ? AND r.result = 'due' AND substr(r.created_at, 1, 10) = ? ${where}
       AND NOT EXISTS (SELECT 1 FROM reminder_log s WHERE s.target_kind = r.target_kind AND s.target_id = r.target_id AND s.rule = r.rule AND s.result = 'shared')
     ORDER BY r.id`,
    businessId,
    today,
    ...params,
  );
}

/** One item per document or contract, with every rule due on it today. */
export async function whatsappDue(db: D1Database, businessId: number, today: string): Promise<WhatsAppDue[]> {
  const byTarget = new Map<string, WhatsAppDue>();
  for (const r of await dueRows(db, businessId, today)) {
    const key = `${r.target_kind}:${r.target_id}`;
    const d = r.details ? (JSON.parse(r.details) as { label?: string }) : {};
    const item = byTarget.get(key);
    if (item) {
      item.id = r.id;
      item.rules.push(r.rule);
      continue;
    }
    let phone = r.phone;
    if (r.target_kind === 'contract') {
      const c = await first<{ status: string; signer_phone: string | null }>(db, 'SELECT status, signer_phone FROM contracts WHERE id = ?', r.target_id);
      // Signed, declined or void since the run: nothing to remind.
      if (!c || (c.status !== 'sent' && c.status !== 'viewed')) continue;
      phone = c.signer_phone ?? phone;
    }
    byTarget.set(key, {
      id: r.id,
      clientId: r.client_id,
      clientName: clientDisplayName({ name_en: r.name_en, name_he: r.name_he }, 'en'),
      targetKind: r.target_kind,
      targetId: r.target_id,
      label: d.label ?? '',
      rules: [r.rule],
      phone,
    });
  }
  return [...byTarget.values()];
}

/** Builds the prefilled WhatsApp message for one due item and logs it shared. */
export async function shareDue(env: Env, actor: AuditActor, businessId: number, logId: number, today: string, baseUrl: string): Promise<{ waUrl: string }> {
  const db = env.DB;
  const row = await first<ReminderLogRow & { business_id: number }>(db, "SELECT * FROM reminder_log WHERE id = ? AND business_id = ? AND result = 'due'", logId, businessId);
  if (!row) throw new NotFoundError('Reminder', logId);
  const due = await dueRows(db, businessId, today, 'AND r.target_kind = ? AND r.target_id = ?', row.target_kind, row.target_id);
  if (due.length === 0) throw new ConflictError('reminder_done', 'This reminder was already shared.');
  const client = due[0]!;

  let waUrl: string;
  if (row.target_kind === 'contract') {
    // The same link the client got, through Remind, so the contract records it.
    const res = await remindContract({ env, engine: { renderPdf: () => Promise.reject(new Error('No engine needed.')) }, mailer: null, notifier: { send: async () => true }, baseUrl }, actor, row.target_id, { channel: 'link' });
    waUrl = res.whatsappUrl;
  } else {
    const doc = await first<{ type: string; number: number | null; due_date: string | null }>(db, 'SELECT type, number, due_date FROM documents WHERE id = ? AND business_id = ?', row.target_id, businessId);
    if (!doc) throw new NotFoundError('Document', row.target_id);
    const direction = doc.due_date && doc.due_date < today ? 'after' : 'before';
    const sender = await senderName(db, businessId);
    const text = reminderEmailText(clientDisplayName(client, 'en'), displayNumber(doc.type, doc.number), direction, await paymentLinkSettings(db, businessId), sender);
    waUrl = whatsappUrl(client.phone, text);
  }

  for (const r of due) {
    await logReminder(db, { businessId, clientId: r.client_id, targetKind: r.target_kind, targetId: r.target_id, channel: 'whatsapp_due', rule: r.rule, result: 'shared', details: { label: r.details ? (JSON.parse(r.details) as { label?: string }).label ?? null : null, by: actor.email } });
  }
  return { waUrl };
}
