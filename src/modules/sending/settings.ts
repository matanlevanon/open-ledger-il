import { printedIdentity } from '../businesses/service';
import { readBusinessSetting, settingKey } from '../../core/business';
import { run } from '../../core/db';
import { ValidationError } from '../../core/errors';

/** R24: sending settings belong to one business. Business 1 keeps its bare keys. */
async function setting(db: D1Database, businessId: number, key: string): Promise<string | null> {
  return readBusinessSetting(db, businessId, key, false);
}

async function setSetting(db: D1Database, businessId: number, key: string, value: string): Promise<void> {
  await run(
    db,
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    settingKey(businessId, key),
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

export async function reminderSettings(db: D1Database, businessId: number): Promise<ReminderSettings> {
  const [enabled, before, after] = await Promise.all([
    setting(db, businessId, 'sending.reminders_enabled'),
    setting(db, businessId, 'sending.reminder_before_days'),
    setting(db, businessId, 'sending.reminder_after_days'),
  ]);
  return {
    enabled: enabled !== 'false',
    beforeDays: parseDayList(before, DEFAULT_BEFORE_DAYS),
    afterDays: parseDayList(after, DEFAULT_AFTER_DAYS),
  };
}

export async function setReminderSettings(db: D1Database, businessId: number, input: Partial<ReminderSettings>): Promise<void> {
  if (input.enabled !== undefined) await setSetting(db, businessId, 'sending.reminders_enabled', input.enabled ? 'true' : 'false');
  if (input.beforeDays !== undefined) await setSetting(db, businessId, 'sending.reminder_before_days', input.beforeDays.join(','));
  if (input.afterDays !== undefined) await setSetting(db, businessId, 'sending.reminder_after_days', input.afterDays.join(','));
}

/** The name printed in emails and on the public consent page: the brand, else the business (R24). */
export async function businessDisplayName(db: D1Database, businessId: number, brandId: number | null = null): Promise<string> {
  const identity = await printedIdentity(db, businessId, brandId);
  return identity.nameEn.trim() || identity.nameHe.trim() || 'The sender';
}

/** Addresses blind-copied (BCC) on every document email, comma separated. Empty when none. The key keeps its first name. */
export async function ccSetting(db: D1Database, businessId: number): Promise<string> {
  return (await setting(db, businessId, 'sending.cc_emails')) ?? '';
}

export async function setCcSetting(db: D1Database, businessId: number, value: string | null): Promise<void> {
  await setSetting(db, businessId, 'sending.cc_emails', value ?? '');
}

export interface PaymentLinkSettings {
  stripe: string | null;
  paypal: string | null;
}

/** Optional static payment links (docs/../runs/R06-sending.md: "optional Stripe or PayPal link from settings"). */
export async function paymentLinkSettings(db: D1Database, businessId: number): Promise<PaymentLinkSettings> {
  const [stripe, paypal] = await Promise.all([
    setting(db, businessId, 'sending.stripe_payment_link'),
    setting(db, businessId, 'sending.paypal_payment_link'),
  ]);
  return { stripe, paypal };
}

export async function setPaymentLinkSettings(db: D1Database, businessId: number, input: Partial<PaymentLinkSettings>): Promise<void> {
  if (input.stripe !== undefined) await setSetting(db, businessId, 'sending.stripe_payment_link', input.stripe ?? '');
  if (input.paypal !== undefined) await setSetting(db, businessId, 'sending.paypal_payment_link', input.paypal ?? '');
}
