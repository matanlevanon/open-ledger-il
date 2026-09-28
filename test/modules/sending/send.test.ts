import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { finalizeDocument } from '../../../src/core/numbering';
import { ConsentRequiredError } from '../../../src/core/errors';
import { acceptConsent } from '../../../src/modules/sending/consent';
import { FakeMailer } from '../../../src/modules/sending/mailer';
import { sendDocumentEmail } from '../../../src/modules/sending/send';
import { insertPaymentRequest, insertSendingClient } from '../../fixtures/sending/db';
import { FakeSignablePdfEngine, makeTestSigningIdentity, type TestSigningIdentity } from '../../fixtures/sending/pdf';
import { OWNER_ACTOR, db } from '../../helpers';

let identity: TestSigningIdentity;

beforeAll(() => {
  identity = makeTestSigningIdentity();
});

function deps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    db: db(),
    files: env.FILES,
    env: { ...env, SIGNING_KEY_PEM: identity.keyPem, SIGNING_CERT_PEM: identity.certPem, ...overrides },
    mailer: new FakeMailer(),
    engine: new FakeSignablePdfEngine(),
    baseUrl: 'https://ledger.test',
  } as Parameters<typeof sendDocumentEmail>[0];
}

const actor = { userId: OWNER_ACTOR.userId, email: OWNER_ACTOR.email };

async function finalizedPaymentRequest(clientId: number | null, overrides: { dueDate?: string } = {}) {
  const id = await insertPaymentRequest(clientId, overrides);
  await finalizeDocument(db(), id, { actor: OWNER_ACTOR });
  return id;
}

describe('sendDocumentEmail', () => {
  it('blocks a send to a client with no consent with a typed consent_required error', async () => {
    const clientId = await insertSendingClient();
    const docId = await finalizedPaymentRequest(clientId);
    const d = deps();

    let err: unknown;
    try {
      await sendDocumentEmail(d, { documentId: docId, actor });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConsentRequiredError);
    expect((err as ConsentRequiredError).code).toBe('consent_required');
    expect((err as ConsentRequiredError).message).toMatch(/has not consented to digital documents yet/);
    expect((d.mailer as FakeMailer).sent).toHaveLength(0);

    const log = await db().prepare('SELECT channel, status, reason FROM send_log WHERE document_id = ?').bind(docId).all();
    expect(log.results).toEqual([{ channel: 'email', status: 'blocked', reason: 'consent_required' }]);
  });

  it('sends the signed client PDF once consent is granted, and logs the send', async () => {
    const clientId = await insertSendingClient({ email: 'signed-send@example.com' });
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    const docId = await finalizedPaymentRequest(clientId);
    const d = deps();

    const result = await sendDocumentEmail(d, { documentId: docId, actor });
    expect(result.status).toBe('sent');

    const mailer = d.mailer as FakeMailer;
    expect(mailer.sent).toHaveLength(1);
    const email = mailer.sent[0]!;
    expect(email.to).toBe('signed-send@example.com');
    expect(email.attachments).toHaveLength(1);
    // A signed PDF starts as %PDF like any other, but carries a /ByteRange and /Contents entry (src/modules/signing/pades.ts).
    const pdfText = new TextDecoder().decode(email.attachments![0]!.content);
    expect(pdfText).toContain('/ByteRange');
    expect(pdfText).toContain('/Adobe.PPKLite');

    const rows = await db().prepare('SELECT channel, status, to_address FROM send_log WHERE document_id = ?').bind(docId).all();
    expect(rows.results).toEqual([{ channel: 'email', status: 'sent', to_address: 'signed-send@example.com' }]);

    const events = await db().prepare("SELECT kind FROM document_events WHERE document_id = ? AND kind = 'sent'").bind(docId).all();
    expect(events.results).toHaveLength(1);
  });

  it('refuses to send when the document is not finalized', async () => {
    const clientId = await insertSendingClient();
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    const docId = await insertPaymentRequest(clientId);
    await expect(sendDocumentEmail(deps(), { documentId: docId, actor })).rejects.toThrow(/finalize/i);
  });

  it('refuses to sign and send when the signing secrets are missing (secured mode is the default)', async () => {
    const clientId = await insertSendingClient();
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    const docId = await finalizedPaymentRequest(clientId);
    const d = deps({ SIGNING_KEY_PEM: undefined, SIGNING_CERT_PEM: undefined });

    await expect(sendDocumentEmail(d, { documentId: docId, actor })).rejects.toThrow(/signing/i);
  });

  it('refuses a document with no client', async () => {
    const docId = await finalizedPaymentRequest(null);
    await expect(sendDocumentEmail(deps(), { documentId: docId, actor })).rejects.toThrow(/client/);
  });

  /** R19: a Hebrew-only client (no nameEn) still gets a real greeting, not a blank one. */
  it('greets a Hebrew-only client by their Hebrew name in the email body', async () => {
    const clientId = await insertSendingClient({ nameEn: '', nameHe: 'לקוח עברי בע"מ', email: 'hebrew-only@example.com' });
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    const docId = await finalizedPaymentRequest(clientId);
    const d = deps();

    await sendDocumentEmail(d, { documentId: docId, actor });
    const email = (d.mailer as FakeMailer).sent[0]!;
    expect(email.text).toContain('לקוח עברי בע"מ');
  });

  it('names a Hebrew-only client in the consent_required error instead of leaving it blank', async () => {
    const clientId = await insertSendingClient({ nameEn: '', nameHe: 'לקוח עברי בע"מ' });
    const docId = await finalizedPaymentRequest(clientId);
    await expect(sendDocumentEmail(deps(), { documentId: docId, actor })).rejects.toMatchObject({
      details: { clientName: 'לקוח עברי בע"מ' },
    });
  });
});
