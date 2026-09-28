import { beforeEach, describe, expect, it } from 'vitest';
import { finalizeDocument } from '../../../src/core/numbering';
import { acceptConsent } from '../../../src/modules/sending/consent';
import { FakeMailer } from '../../../src/modules/sending/mailer';
import { runReminders } from '../../../src/modules/sending/reminders';
import { insertPaymentRequest, insertSendingClient } from '../../fixtures/sending/db';
import { OWNER_ACTOR, db } from '../../helpers';

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

    const result = await runReminders({ db: db(), mailer, today: TODAY });
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

    const result = await runReminders({ db: db(), mailer, today: TODAY });
    expect(result.sent).toBe(1);
    expect(mailer.sent[0]!.subject).toMatch(/Reminder/);
    expect(mailer.sent[0]!.html).toMatch(/overdue/i);
  });

  it('does not remind on a day that is not configured', async () => {
    const clientId = await insertSendingClient({ email: 'off-day@example.com' });
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    await finalizedRequest(clientId, '2026-11-15'); // 5 days out, not in the default [3] before list

    const result = await runReminders({ db: db(), mailer, today: TODAY });
    expect(result.sent).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it('never sends the same reminder twice for the same document and offset', async () => {
    const clientId = await insertSendingClient({ email: 'once@example.com' });
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    await finalizedRequest(clientId, '2026-11-13');

    const first = await runReminders({ db: db(), mailer, today: TODAY });
    const second = await runReminders({ db: db(), mailer, today: TODAY });

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(mailer.sent).toHaveLength(1);
  });

  it('skips a demand with no due date', async () => {
    const clientId = await insertSendingClient({ email: 'no-due-date@example.com' });
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    const id = await insertPaymentRequest(clientId, { date: '2026-10-01' });
    await finalizeDocument(db(), id, { actor: OWNER_ACTOR });

    const result = await runReminders({ db: db(), mailer, today: TODAY });
    expect(result.sent).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });
});
