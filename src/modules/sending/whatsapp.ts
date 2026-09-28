import { first, run } from '../../core/db';
import { ConfigError, ConsentRequiredError, ValidationError } from '../../core/errors';
import type { Env } from '../../env';
import { clientDisplayName } from '../clients/display';
import { getDoc } from '../documents/repo';
import { BrowserRenderingPdfEngine, type PdfEngine, renderAndStore, resolveSigningIdentity } from '../pdf';
import { isConsentGranted } from './consent';
import type { Mailer } from './mailer';
import { SHARE_LINK_TTL_SECONDS, expiresAt, signSendToken } from './tokens';
import type { SendActor } from './send';

function engineFor(env: Env): PdfEngine {
  if (!env.BROWSER) throw new ConfigError('Browser Rendering is not configured (the BROWSER binding is missing).');
  return new BrowserRenderingPdfEngine(env.BROWSER);
}

export interface WhatsAppLinkDeps {
  db: D1Database;
  files: R2Bucket;
  env: Env;
  mailer: Mailer;
  engine?: PdfEngine;
  baseUrl: string;
}

export type WhatsAppLinkResult = { status: 'ready'; url: string; waUrl: string | null; expiresAt: string };

/**
 * Builds a signed, 30-day link to the client-copy PDF for the owner to paste into WhatsApp
 * (docs run brief: "signed, expiring public link to the client PDF"). Same consent and
 * allocation gates as `sendDocumentEmail`, since this is still a digital hand-off of the
 * document (instruction 18ב); no link is minted here, the owner shares the link themselves.
 * A client with no granted consent blocks with a typed `consent_required` error (R16 task 2).
 */
export async function createWhatsAppLink(deps: WhatsAppLinkDeps, documentId: number, actor: SendActor): Promise<WhatsAppLinkResult> {
  const { db, files, env, baseUrl } = deps;
  const doc = await getDoc(db, documentId);
  if (doc.status !== 'final') throw new ValidationError('Finalize the document before you send it.');
  if (doc.client_id === null) throw new ValidationError('This document has no client to send to.');

  if (!(await isConsentGranted(db, doc.client_id))) {
    const consentClient = await first<{ name_en: string | null; name_he: string | null }>(
      db,
      'SELECT name_en, name_he FROM clients WHERE id = ?',
      doc.client_id,
    );
    await run(
      db,
      `INSERT INTO send_log (document_id, client_id, channel, status, reason) VALUES (?, ?, 'whatsapp', 'blocked', 'consent_required')`,
      doc.id,
      doc.client_id,
    );
    throw new ConsentRequiredError(consentClient ? clientDisplayName(consentClient, 'en') || 'This client' : 'This client', doc.client_id);
  }

  const engine = deps.engine ?? engineFor(env);
  const signing = await resolveSigningIdentity(db, env, { require: true });
  const options = { ownerTaxId: env.OWNER_TAX_ID ?? null, files: env.FILES };
  await renderAndStore(db, files, engine, doc.id, 'client', options, signing);
  await renderAndStore(db, files, engine, doc.id, 'filed', options, signing);

  const exp = expiresAt(SHARE_LINK_TTL_SECONDS);
  const token = await signSendToken(env, { kind: 'share', documentId: doc.id, variant: 'client', exp });
  const url = `${baseUrl}/api/sending/public/share/${token}`;

  const client = await first<{ phone: string | null }>(db, 'SELECT phone FROM clients WHERE id = ?', doc.client_id);
  const phone = client?.phone ? client.phone.replace(/[^\d]/g, '') : null;
  const waUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(url)}` : null;

  await run(
    db,
    `INSERT INTO send_log (document_id, client_id, channel, status) VALUES (?, ?, 'whatsapp', 'sent')`,
    doc.id,
    doc.client_id,
  );
  await run(
    db,
    `INSERT INTO document_events (document_id, kind, user_id, user_email, details) VALUES (?, 'sent', ?, ?, ?)`,
    doc.id,
    actor.userId,
    actor.email,
    JSON.stringify({ channel: 'whatsapp' }),
  );

  return { status: 'ready', url, waUrl, expiresAt: new Date(exp * 1000).toISOString() };
}
