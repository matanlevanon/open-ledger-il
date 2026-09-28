import { first, run } from '../../core/db';
import { ValidationError } from '../../core/errors';

async function setting(db: D1Database, key: string): Promise<string | null> {
  const row = await first<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? null;
}

async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await run(
    db,
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value,
  );
}

function parseDayList(raw: string | null, fallback: number[]): number[] {
  if (raw === null || raw.trim() === '') return fallback.length === 0 ? [] : fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n < 0) throw new ValidationError(`Reminder days must be whole numbers: "${s}"`);
      return n;
    });
}

export interface ReminderSettings {
  enabled: boolean;
  /** Days before due_date to remind, e.g. [3]. */
  beforeDays: number[];
  /** Days after due_date to remind, e.g. [3, 10]. */
  afterDays: number[];
}

const DEFAULT_BEFORE_DAYS = [3];
const DEFAULT_AFTER_DAYS = [3, 10];

export async function reminderSettings(db: D1Database): Promise<ReminderSettings> {
  const [enabled, before, after] = await Promise.all([
    setting(db, 'sending.reminders_enabled'),
    setting(db, 'sending.reminder_before_days'),
    setting(db, 'sending.reminder_after_days'),
  ]);
  return {
    enabled: enabled !== 'false',
    beforeDays: parseDayList(before, DEFAULT_BEFORE_DAYS),
    afterDays: parseDayList(after, DEFAULT_AFTER_DAYS),
  };
}

export async function setReminderSettings(db: D1Database, input: Partial<ReminderSettings>): Promise<void> {
  if (input.enabled !== undefined) await setSetting(db, 'sending.reminders_enabled', input.enabled ? 'true' : 'false');
  if (input.beforeDays !== undefined) await setSetting(db, 'sending.reminder_before_days', input.beforeDays.join(','));
  if (input.afterDays !== undefined) await setSetting(db, 'sending.reminder_after_days', input.afterDays.join(','));
}

/** The business name printed in emails and on the public consent page, from Settings > Business. */
export async function businessDisplayName(db: D1Database): Promise<string> {
  const row = await first<{ name_en: string }>(db, 'SELECT name_en FROM business_profile WHERE id = 1');
  return row?.name_en?.trim() || 'The sender';
}

export interface PaymentLinkSettings {
  stripe: string | null;
  paypal: string | null;
}

/** Optional static payment links (docs/../runs/R06-sending.md: "optional Stripe or PayPal link from settings"). */
export async function paymentLinkSettings(db: D1Database): Promise<PaymentLinkSettings> {
  const [stripe, paypal] = await Promise.all([setting(db, 'sending.stripe_payment_link'), setting(db, 'sending.paypal_payment_link')]);
  return { stripe, paypal };
}

export async function setPaymentLinkSettings(db: D1Database, input: Partial<PaymentLinkSettings>): Promise<void> {
  if (input.stripe !== undefined) await setSetting(db, 'sending.stripe_payment_link', input.stripe ?? '');
  if (input.paypal !== undefined) await setSetting(db, 'sending.paypal_payment_link', input.paypal ?? '');
}
