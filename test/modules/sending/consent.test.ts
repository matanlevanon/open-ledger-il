import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { acceptConsent, consentHistory, consentState, requestConsent, revokeConsent } from '../../../src/modules/sending/consent';
import { FakeMailer } from '../../../src/modules/sending/mailer';
import { insertSendingClient } from '../../fixtures/sending/db';
import { db } from '../../helpers';

describe('consent flow', () => {
  let mailer: FakeMailer;

  beforeEach(() => {
    mailer = new FakeMailer();
  });

  it('has no consent for a fresh client', async () => {
    const clientId = await insertSendingClient();
    expect(await consentState(db(), clientId)).toEqual({ status: 'none', at: null });
  });

  it('emails a consent request with a link and records a requested row', async () => {
    const clientId = await insertSendingClient({ email: 'consent-target@example.com' });
    const result = await requestConsent(db(), env, mailer, clientId, 'https://ledger.test');

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe('consent-target@example.com');
    expect(mailer.sent[0]!.html).toContain('https://ledger.test/api/sending/public/consent/');
    expect(result.status).toBe('sent');

    expect(await consentState(db(), clientId)).toMatchObject({ status: 'requested' });
  });

  it('refuses to request consent for a client with no email', async () => {
    const clientId = await insertSendingClient({ email: null });
    await expect(requestConsent(db(), env, mailer, clientId, 'https://ledger.test')).rejects.toThrow(/email/);
  });

  /** R19: a Hebrew-only client (no nameEn) still gets a real greeting, not a blank one. */
  it('greets a Hebrew-only client by their Hebrew name in the consent request email', async () => {
    const clientId = await insertSendingClient({ nameEn: '', nameHe: 'לקוח עברי בע"מ', email: 'hebrew-only@example.com' });
    await requestConsent(db(), env, mailer, clientId, 'https://ledger.test');
    expect(mailer.sent[0]!.text).toContain('לקוח עברי בע"מ');
  });

  it('accept records the timestamp, ip and user agent, and grants consent', async () => {
    const clientId = await insertSendingClient();
    await acceptConsent(db(), { clientId, ip: '203.0.113.9', userAgent: 'TestAgent/1.0' });

    expect(await consentState(db(), clientId)).toMatchObject({ status: 'granted' });
    const history = await consentHistory(db(), clientId);
    expect(history[0]).toMatchObject({ status: 'granted', ip: '203.0.113.9' });
  });

  it('revoke supersedes a granted consent', async () => {
    const clientId = await insertSendingClient();
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    expect(await consentState(db(), clientId)).toMatchObject({ status: 'granted' });

    await revokeConsent(db(), clientId);
    expect(await consentState(db(), clientId)).toMatchObject({ status: 'revoked' });
  });

  it('keeps every consent event, oldest last, for the audit trail', async () => {
    const clientId = await insertSendingClient();
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    await revokeConsent(db(), clientId);
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });

    const history = await consentHistory(db(), clientId);
    expect(history.map((h) => h.status)).toEqual(['granted', 'revoked', 'granted']);
  });
});
