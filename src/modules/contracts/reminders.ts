import { systemActorFor } from '../../core/audit';
import { all } from '../../core/db';
import { clientAutoReminders, logReminder, ruleFired } from '../sending/reminder-log';
import { contractReminderSettings } from '../sending/settings';
import { type ContractDeps, remindContract } from './service';
import { type ContractRow, EXPIRING_WITHIN_DAYS } from './types';

/**
 * R28: automatic signing reminders from the 07:00 cron. Each rule fires once per contract:
 * `unsigned_<N>` after N days without a signature, `ends_2` when the link ends within 2 days. The
 * email goes through the manual Remind path, so the contract records a reminded event. Without
 * email the reminder is logged as due on WhatsApp for the dashboard, when the signer has a phone.
 *
 * Skips signed, void, declined and expired contracts, contracts signed outside the Ledger, and
 * clients with automatic reminders off.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ContractReminderResult {
  emailed: number[];
  whatsappDue: number[];
  skipped: number;
}

export function dueRules(row: Pick<ContractRow, 'sent_at' | 'expires_at'>, now: Date, s: { afterDays: number[]; beforeEnd: boolean }): string[] {
  if (!row.sent_at || !row.expires_at) return [];
  const since = Math.floor((now.getTime() - Date.parse(row.sent_at)) / DAY_MS);
  const rules = s.afterDays.filter((n) => n > 0 && since >= n).map((n) => `unsigned_${n}`);
  if (s.beforeEnd && Date.parse(row.expires_at) - now.getTime() <= EXPIRING_WITHIN_DAYS * DAY_MS) rules.push(`ends_${EXPIRING_WITHIN_DAYS}`);
  return rules;
}

export async function runContractReminders(deps: ContractDeps, businessId: number): Promise<ContractReminderResult> {
  const db = deps.env.DB;
  const now = deps.now ? deps.now() : new Date();
  const out: ContractReminderResult = { emailed: [], whatsappDue: [], skipped: 0 };
  const settings = await contractReminderSettings(db, businessId);
  if (!settings.enabled) return out;
  const rows = await all<ContractRow>(
    db,
    "SELECT * FROM contracts WHERE business_id = ? AND origin = 'ledger' AND status IN ('sent', 'viewed') AND expires_at > ? ORDER BY id",
    businessId,
    now.toISOString(),
  );
  for (const row of rows) {
    const rules = [];
    for (const rule of dueRules(row, now, settings)) if (!(await ruleFired(db, 'contract', row.id, rule))) rules.push(rule);
    if (rules.length === 0) continue;
    if (!(await clientAutoReminders(db, row.client_id))) {
      out.skipped++;
      continue;
    }
    const at = now.toISOString();
    const base = { businessId, clientId: row.client_id, targetKind: 'contract' as const, targetId: row.id, at };
    if (deps.mailer && row.signer_email) {
      let result: 'sent' | 'failed' = 'sent';
      let error: string | null = null;
      try {
        await remindContract(deps, systemActorFor(businessId), row.id, { channel: 'email' });
      } catch (err) {
        result = 'failed';
        error = err instanceof Error ? err.message : String(err);
      }
      // One email covers every rule due today. Each rule gets its own row, so none fires again.
      for (const rule of rules) await logReminder(db, { ...base, channel: 'email', rule, result, details: { label: row.title, to: row.signer_email, ...(error ? { error } : {}) } });
      if (result === 'sent') out.emailed.push(row.id);
      else out.skipped++;
    } else if (row.signer_phone) {
      for (const rule of rules) await logReminder(db, { ...base, channel: 'whatsapp_due', rule, result: 'due', details: { label: row.title } });
      out.whatsappDue.push(row.id);
    } else {
      out.skipped++;
    }
  }
  return out;
}
