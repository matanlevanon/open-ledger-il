import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/index';
import { finalizeDocument } from '../../../src/core/numbering';
import { acceptConsent } from '../../../src/modules/sending/consent';
import { FakeMailer } from '../../../src/modules/sending/mailer';
import { runReminders } from '../../../src/modules/sending/reminders';
import { insertPaymentRequest, insertSendingClient } from '../../fixtures/sending/db';
import { OWNER_ACTOR, db } from '../../helpers';

const logOf = async (documentId: number) =>
  (
    await db()
      .prepare("SELECT channel, rule, result FROM reminder_log WHERE target_kind = 'document' AND target_id = ? ORDER BY id")
      .bind(documentId)
      .all<{ channel: string; rule: string; result: string }>()
  ).results;

const TODAY = '2026-11-10';

async function finalizedRequest(clientId: number, dueDate: string) {
  const id = await insertPaymentRequest(clientId, { dueDate, date: '2026-10-01' });
  await finalizeDocument(db(), id, { actor: OWNER_ACTOR });
  return id;
}

describe('runReminders', () => {
  let mailer: FakeMailer;

  beforeEach(() => {
    mailer = new FakeMailer();
  });

  it('sends a before-due reminder exactly on the configured day, only with consent', async () => {
    const withConsent = await insertSendingClient({ email: 'before@example.com' });
    await acceptConsent(db(), { clientId: withConsent, ip: null, userAgent: null });
    const dueSoon = await finalizedRequest(withConsent, '2026-11-13'); // 3 days out

    const noConsent = await insertSendingClient({ email: 'no-consent@example.com' });
    await finalizedRequest(noConsent, '2026-11-13');

    const result = await runReminders({ db: db(), mailer, today: TODAY , businessId: 1 });
    expect(result.sent).toBe(1);

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe('before@example.com');

    const logged = await db()
      .prepare("SELECT channel, reason FROM send_log WHERE document_id = ? AND channel = 'reminder_before'")
      .bind(dueSoon)
      .all();
    expect(logged.results).toEqual([{ channel: 'reminder_before', reason: 'days=3' }]);
  });

  it('sends an after-due (overdue) reminder on the configured day', async () => {
    const clientId = await insertSendingClient({ email: 'overdue@example.com' });
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    await finalizedRequest(clientId, '2026-11-07'); // 3 days overdue

    const result = await runReminders({ db: db(), mailer, today: TODAY , businessId: 1 });
    expect(result.sent).toBe(1);
    expect(mailer.sent[0]!.subject).toMatch(/Reminder/);
    expect(mailer.sent[0]!.html).toMatch(/overdue/i);
  });

  it('does not remind on a day that is not configured', async () => {
    const clientId = await insertSendingClient({ email: 'off-day@example.com' });
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    await finalizedRequest(clientId, '2026-11-15'); // 5 days out, not in the default [3] before list

    const result = await runReminders({ db: db(), mailer, today: TODAY , businessId: 1 });
    expect(result.sent).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it('never sends the same reminder twice for the same document and offset', async () => {
    const clientId = await insertSendingClient({ email: 'once@example.com' });
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    await finalizedRequest(clientId, '2026-11-13');

    const first = await runReminders({ db: db(), mailer, today: TODAY , businessId: 1 });
    const second = await runReminders({ db: db(), mailer, today: TODAY , businessId: 1 });

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(mailer.sent).toHaveLength(1);
  });

  it('skips a demand with no due date', async () => {
    const clientId = await insertSendingClient({ email: 'no-due-date@example.com' });
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    const id = await insertPaymentRequest(clientId, { date: '2026-10-01' });
    await finalizeDocument(db(), id, { actor: OWNER_ACTOR });

    const result = await runReminders({ db: db(), mailer, today: TODAY , businessId: 1 });
    expect(result.sent).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('R28 payment reminders: the client switch and the log', () => {
  let mailer: FakeMailer;

  beforeEach(() => {
    mailer = new FakeMailer();
  });

  it('logs each send to reminder_log with its rule', async () => {
    const clientId = await insertSendingClient({ email: 'logged@example.com' });
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    const id = await finalizedRequest(clientId, '2026-11-13');
    await runReminders({ db: db(), mailer, today: TODAY, businessId: 1 });
    expect(await logOf(id)).toEqual([{ channel: 'email', rule: 'before_3', result: 'sent' }]);
  });

  it('skips a client with automatic reminders off', async () => {
    const clientId = await insertSendingClient({ email: 'quiet@example.com' });
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    await db().prepare('UPDATE clients SET auto_reminders = 0 WHERE id = ?').bind(clientId).run();
    const id = await finalizedRequest(clientId, '2026-11-13');
    await runReminders({ db: db(), mailer, today: TODAY, businessId: 1 });
    expect(mailer.sent.some((m) => m.to === 'quiet@example.com')).toBe(false);
    expect(await logOf(id)).toEqual([]);
  });

  it('a client with a phone and no email gets a WhatsApp reminder due, once', async () => {
    const clientId = await insertSendingClient({ email: null, phone: '+972501112222' });
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    const id = await finalizedRequest(clientId, '2026-11-13');
    await runReminders({ db: db(), mailer, today: TODAY, businessId: 1 });
    await runReminders({ db: db(), mailer, today: TODAY, businessId: 1 });
    expect(await logOf(id)).toEqual([{ channel: 'whatsapp_due', rule: 'before_3', result: 'due' }]);
  });

  it('with email off, nothing is emailed and the reminder is due on WhatsApp', async () => {
    const clientId = await insertSendingClient({ email: 'off@example.com' });
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    const id = await finalizedRequest(clientId, '2026-11-07');
    const result = await runReminders({ db: db(), mailer: null, today: TODAY, businessId: 1 });
    expect(result.sent).toBe(0);
    expect(await logOf(id)).toEqual([{ channel: 'whatsapp_due', rule: 'after_3', result: 'due' }]);
  });

  it('a client with neither email nor phone is skipped and nothing is logged', async () => {
    const clientId = await insertSendingClient({ email: null, phone: null });
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    const id = await finalizedRequest(clientId, '2026-11-13');
    await runReminders({ db: db(), mailer, today: TODAY, businessId: 1 });
    expect(await logOf(id)).toEqual([]);
  });
});

describe('R28 reminder settings routes', () => {
  const app = createApp();
  const req = (method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, { ...env, DEV_AUTH_EMAIL: 'owner@example.com' });

  it('reads both reminder settings with their defaults and saves the contract ones', async () => {
    const before = (await (await req('GET', '/sending/settings')).json()) as any;
    expect(before.reminders).toEqual({ enabled: true, beforeDays: [3], afterDays: [3, 10] });
    expect(before.contractReminders).toEqual({ enabled: true, afterDays: [3, 7], beforeEnd: true });
    const saved = await req('PUT', '/sending/settings/contract-reminders', { enabled: true, afterDays: [5], beforeEnd: false });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ enabled: true, afterDays: [5], beforeEnd: false });
    expect((await req('PUT', '/sending/settings/contract-reminders', { afterDays: [0] })).status).toBe(400);
  });
});
