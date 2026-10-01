import { first, run } from '../../core/db';
import { ConfigError, ConsentRequiredError, ValidationError } from '../../core/errors';
import type { Env } from '../../env';
import { clientDisplayName } from '../clients/display';
import { getDoc } from '../documents/repo';
import { displayNumber } from '../documents/types';
import { BrowserRenderingPdfEngine, type PdfEngine, resolveSigningIdentity, renderAndStore } from '../pdf';
import { finalCc, splitCc } from './cc';
import { isConsentGranted } from './consent';
import type { Mailer } from './mailer';
import { businessDisplayName, ccSetting, paymentLinkSettings } from './settings';
import { documentEmailHtml, documentEmailText } from './templates';

function engineFor(env: Env): PdfEngine {
  if (!env.BROWSER) throw new ConfigError('Browser Rendering is not configured (the BROWSER binding is missing).');
  return new BrowserRenderingPdfEngine(env.BROWSER);
}

export interface SendDeps {
  db: D1Database;
  files: R2Bucket;
  env: Env;
  mailer: Mailer;
  /** Overrides the real Browser Rendering engine. Tests pass a fake that renders a real, signable PDF. */
  engine?: PdfEngine;
  /** Origin used to build the consent link, e.g. "https://ledger.example.com". */
  baseUrl: string;
}

export interface SendActor {
  userId: number | null;
  email: string | null;
}

export interface SendEmailInput {
  documentId: number;
  actor: SendActor;
  /** Overrides the client's email on file. */
  to?: string | null;
  /**
   * Copies for this send. Given (even empty): exactly these. Omitted: the account list in
   * Settings > Email plus the client's own copy list.
   */
  cc?: string[] | null;
  message?: string | null;
}

/** The To and CC a send would use by default, to prefill the send form. */
export async function sendDefaults(db: D1Database, documentId: number): Promise<{ to: string | null; cc: string[] }> {
  const doc = await getDoc(db, documentId);
  const client =
    doc.client_id === null ? null : await first<{ email: string | null; cc_emails: string | null }>(db, 'SELECT email, cc_emails FROM clients WHERE id = ?', doc.client_id);
  const to = client?.email ?? null;
  const cc = finalCc(to ?? '', splitCc(await ccSetting(db)), splitCc(client?.cc_emails));
  return { to, cc };
}

export type SendEmailResult = { status: 'sent'; messageId: string | null };

async function recordSentEvent(db: D1Database, documentId: number, channel: string, to: string | null, actor: SendActor, cc: string[] = []): Promise<void> {
  await run(
    db,
    `INSERT INTO document_events (document_id, kind, user_id, user_email, details) VALUES (?, 'sent', ?, ?, ?)`,
    documentId,
    actor.userId,
    actor.email,
    JSON.stringify(cc.length > 0 ? { channel, to, cc } : { channel, to }),
  );
}

async function isDemand(db: D1Database, type: string): Promise<boolean> {
  const row = await first<{ kind: string }>(db, 'SELECT kind FROM document_types WHERE code = ?', type);
  return row?.kind === 'demand';
}

/**
 * Sends a finalized document by email: renders and signs the client-copy PDF (blocked by R12's
 * allocation gate inside `renderAndStore` for a qualifying tax invoice, CLAUDE.md rule 3), also
 * files the filed copy, attaches the client PDF, and logs the attempt. A client with no granted
 * consent (instruction 18ב) blocks the send with a typed `consent_required` error; the caller
 * offers to send a consent request or record consent manually (R16 task 2), rather than this
 * function silently emailing a request on the caller's behalf.
 */
export async function sendDocumentEmail(deps: SendDeps, input: SendEmailInput): Promise<SendEmailResult> {
  const { db, files, env, mailer, baseUrl } = deps;
  const doc = await getDoc(db, input.documentId);
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
      `INSERT INTO send_log (document_id, client_id, channel, to_address, status, reason) VALUES (?, ?, 'email', ?, 'blocked', 'consent_required')`,
      doc.id,
      doc.client_id,
      input.to ?? null,
    );
    throw new ConsentRequiredError(consentClient ? clientDisplayName(consentClient, 'en') || 'This client' : 'This client', doc.client_id);
  }

  const client = await first<{ email: string | null; cc_emails: string | null; name_en: string | null; name_he: string | null }>(
    db,
    'SELECT email, cc_emails, name_en, name_he FROM clients WHERE id = ?',
    doc.client_id,
  );
  const to = input.to ?? client?.email ?? null;
  if (!to) throw new ValidationError('This client has no email address on file. Provide one.');
  const cc = input.cc != null ? finalCc(to, input.cc) : finalCc(to, splitCc(await ccSetting(db)), splitCc(client?.cc_emails));

  const engine = deps.engine ?? engineFor(env);
  const signing = await resolveSigningIdentity(db, env, { require: true });
  const options = { ownerTaxId: env.OWNER_TAX_ID ?? null, files: env.FILES };
  const clientPdf = await renderAndStore(db, files, engine, doc.id, 'client', options, signing);
  await renderAndStore(db, files, engine, doc.id, 'filed', options, signing);

  const links = (await isDemand(db, doc.type)) ? await paymentLinkSettings(db) : { stripe: null, paypal: null };
  const number = displayNumber(doc.type, doc.number);
  const clientName = client ? clientDisplayName(client, 'en') : '';
  const businessName = await businessDisplayName(db);

  let messageId: string | null = null;
  let status: 'sent' | 'failed' = 'sent';
  let reason: string | null = null;
  try {
    const sent = await mailer.send({
      to,
      cc,
      subject: number ? `${number} from ${businessName}` : `Your document from ${businessName}`,
      html: documentEmailHtml(clientName, number, links, input.message ?? null, businessName),
      text: documentEmailText(clientName, number, links, input.message ?? null, businessName),
      attachments: [{ filename: `${number ?? doc.id}.pdf`, content: clientPdf.bytes, contentType: 'application/pdf' }],
    });
    messageId = sent.id;
  } catch (err) {
    status = 'failed';
    reason = err instanceof Error ? err.message : String(err);
  }

  await run(
    db,
    `INSERT INTO send_log (document_id, client_id, channel, to_address, cc_addresses, status, reason, provider_message_id) VALUES (?, ?, 'email', ?, ?, ?, ?, ?)`,
    doc.id,
    doc.client_id,
    to,
    cc.length > 0 ? cc.join(', ') : null,
    status,
    reason,
    messageId,
  );

  if (status === 'failed') throw new Error(`Could not send the document: ${reason}`);

  await recordSentEvent(db, doc.id, 'email', to, input.actor, cc);
  return { status: 'sent', messageId };
}
