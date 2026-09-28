import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { finalizeDocument } from '../../../src/core/numbering';
import { ConsentRequiredError } from '../../../src/core/errors';
import { acceptConsent } from '../../../src/modules/sending/consent';
import { FakeMailer } from '../../../src/modules/sending/mailer';
import { verifySendToken } from '../../../src/modules/sending/tokens';
import { createWhatsAppLink } from '../../../src/modules/sending/whatsapp';
import { insertPaymentRequest, insertSendingClient } from '../../fixtures/sending/db';
import { FakeSignablePdfEngine, makeTestSigningIdentity, type TestSigningIdentity } from '../../fixtures/sending/pdf';
import { OWNER_ACTOR, db } from '../../helpers';

let identity: TestSigningIdentity;

beforeAll(() => {
  identity = makeTestSigningIdentity();
});

function deps() {
  return {
    db: db(),
    files: env.FILES,
    env: { ...env, SIGNING_KEY_PEM: identity.keyPem, SIGNING_CERT_PEM: identity.certPem },
    mailer: new FakeMailer(),
    engine: new FakeSignablePdfEngine(),
    baseUrl: 'https://ledger.test',
  } as Parameters<typeof createWhatsAppLink>[0];
}

const actor = { userId: OWNER_ACTOR.userId, email: OWNER_ACTOR.email };

describe('createWhatsAppLink', () => {
  it('blocks with a typed consent_required error for a client that has not granted consent', async () => {
    const clientId = await insertSendingClient();
    const docId = await insertPaymentRequest(clientId);
    await finalizeDocument(db(), docId, { actor: OWNER_ACTOR });

    await expect(createWhatsAppLink(deps(), docId, actor)).rejects.toThrow(ConsentRequiredError);
  });

  /** R19: a Hebrew-only client (no nameEn) still gets a real name in the error, not a blank one. */
  it('names a Hebrew-only client in the consent_required error', async () => {
    const clientId = await insertSendingClient({ nameEn: '', nameHe: 'לקוח עברי בע"מ' });
    const docId = await insertPaymentRequest(clientId);
    await finalizeDocument(db(), docId, { actor: OWNER_ACTOR });

    await expect(createWhatsAppLink(deps(), docId, actor)).rejects.toMatchObject({
      details: { clientName: 'לקוח עברי בע"מ' },
    });
  });

  it('builds a signed 30-day link and a wa.me URL once consent is granted', async () => {
    const clientId = await insertSendingClient({ phone: '+972501234567' });
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    const docId = await insertPaymentRequest(clientId);
    await finalizeDocument(db(), docId, { actor: OWNER_ACTOR });

    const result = await createWhatsAppLink(deps(), docId, actor);
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.url).toMatch(/^https:\/\/ledger\.test\/api\/sending\/public\/share\//);
    expect(result.waUrl).toMatch(/^https:\/\/wa\.me\/972501234567\?text=/);

    const token = result.url.split('/').pop()!;
    const payload = await verifySendToken(env, token);
    expect(payload).toMatchObject({ kind: 'share', documentId: docId, variant: 'client' });

    const near30Days = Math.round((Date.parse(result.expiresAt) - Date.now()) / 86400000);
    expect(near30Days).toBeGreaterThanOrEqual(29);
    expect(near30Days).toBeLessThanOrEqual(30);
  });

  it('omits the wa.me URL when the client has no phone number', async () => {
    const clientId = await insertSendingClient({ phone: null });
    await acceptConsent(db(), { clientId, ip: null, userAgent: null });
    const docId = await insertPaymentRequest(clientId);
    await finalizeDocument(db(), docId, { actor: OWNER_ACTOR });

    const result = await createWhatsAppLink(deps(), docId, actor);
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.waUrl).toBeNull();
  });
});
