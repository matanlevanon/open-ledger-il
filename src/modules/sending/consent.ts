import { all, first, run, stmt } from '../../core/db';
import { businessDisplayName } from './settings';
import { NotFoundError, ValidationError } from '../../core/errors';
import type { Env } from '../../env';
import { clientDisplayName } from '../clients/display';
import type { Mailer } from './mailer';
import { CONSENT_LINK_TTL_SECONDS, expiresAt, signSendToken } from './tokens';

export type ConsentStatus = 'requested' | 'granted' | 'revoked';

export interface ConsentState {
  status: ConsentStatus | 'none';
  at: string | null;
}

interface ConsentRow {
  status: ConsentStatus;
  at: string;
}

/** The latest consent event for a client, digital-documents kind (instruction 18ב). */
export async function consentState(db: D1Database, clientId: number): Promise<ConsentState> {
  const row = await first<ConsentRow>(
    db,
    `SELECT status, at FROM client_consents WHERE client_id = ? AND kind = 'digital_documents' ORDER BY id DESC LIMIT 1`,
    clientId,
  );
  return row ? { status: row.status, at: row.at } : { status: 'none', at: null };
}

export async function isConsentGranted(db: D1Database, clientId: number): Promise<boolean> {
  return (await consentState(db, clientId)).status === 'granted';
}

interface ClientContact {
  id: number;
  name_en: string;
  name_he: string | null;
  email: string | null;
}

async function loadClient(db: D1Database, clientId: number): Promise<ClientContact> {
  const row = await first<ClientContact>(db, 'SELECT id, name_en, name_he, email FROM clients WHERE id = ?', clientId);
  if (!row) throw new NotFoundError('Client', clientId);
  return row;
}

function escapeName(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function consentEmailHtml(clientName: string, acceptUrl: string, businessName: string): string {
  return `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5">
<p>Hello ${clientName},</p>
<p>${businessName} would like to send you invoices, receipts and other documents by email instead of by post.</p>
<p><a href="${acceptUrl}">Click here to allow digital documents</a></p>
<p style="direction:rtl;text-align:right">בבקשה לאשר קבלת מסמכים באמצעים דיגיטליים בלינק למעלה.</p>
</body></html>`;
}

function consentEmailText(clientName: string, acceptUrl: string, businessName: string): string {
  return `Hello ${clientName},\n\n${businessName} would like to send you invoices, receipts and other documents by email instead of by post.\nOpen this link to allow digital documents: ${acceptUrl}\n`;
}

export interface RequestConsentResult {
  status: 'sent';
  expiresAt: string;
}

/** Emails a consent request with a signed, 14-day link. Records `client_consents` and `send_log`. */
export async function requestConsent(
  db: D1Database,
  env: Pick<Env, 'SEND_LINK_KEY'>,
  mailer: Mailer,
  clientId: number,
  baseUrl: string,
): Promise<RequestConsentResult> {
  const client = await loadClient(db, clientId);
  if (!client.email) throw new ValidationError('This client has no email address on file.');

  const exp = expiresAt(CONSENT_LINK_TTL_SECONDS);
  const token = await signSendToken(env, { kind: 'consent', clientId, exp });
  const acceptUrl = `${baseUrl}/api/sending/public/consent/${token}`;
  const clientName = clientDisplayName(client, 'en');
  const businessName = await businessDisplayName(db);

  let providerMessageId: string | null = null;
  let status: 'sent' | 'failed' = 'sent';
  let reason: string | null = null;
  try {
    const result = await mailer.send({
      to: client.email,
      subject: 'Please confirm you can receive documents by email',
      html: consentEmailHtml(clientName, acceptUrl, escapeName(businessName)),
      text: consentEmailText(clientName, acceptUrl, businessName),
    });
    providerMessageId = result.id;
  } catch (err) {
    status = 'failed';
    reason = err instanceof Error ? err.message : String(err);
  }

  await run(
    db,
    `INSERT INTO client_consents (client_id, kind, status, method) VALUES (?, 'digital_documents', 'requested', 'email_link')`,
    clientId,
  );
  await run(
    db,
    `INSERT INTO send_log (document_id, client_id, channel, to_address, status, reason, provider_message_id)
     VALUES (NULL, ?, 'consent_request', ?, ?, ?, ?)`,
    clientId,
    client.email,
    status,
    reason,
    providerMessageId,
  );

  if (status === 'failed') throw new Error(`Could not send the consent request: ${reason}`);
  return { status: 'sent', expiresAt: new Date(exp * 1000).toISOString() };
}

export interface AcceptConsentInput {
  clientId: number;
  ip: string | null;
  userAgent: string | null;
}

export async function acceptConsent(db: D1Database, input: AcceptConsentInput): Promise<void> {
  await run(
    db,
    `INSERT INTO client_consents (client_id, kind, status, method, ip, user_agent) VALUES (?, 'digital_documents', 'granted', 'email_link', ?, ?)`,
    input.clientId,
    input.ip,
    input.userAgent,
  );
}

export async function revokeConsent(db: D1Database, clientId: number, method = 'owner'): Promise<void> {
  await run(
    db,
    `INSERT INTO client_consents (client_id, kind, status, method) VALUES (?, 'digital_documents', 'revoked', ?)`,
    clientId,
    method,
  );
}

export interface ConsentHistoryEntry {
  id: number;
  status: ConsentStatus;
  at: string;
  method: string | null;
  ip: string | null;
  source: string | null;
  reference_note: string | null;
}

export async function consentHistory(db: D1Database, clientId: number): Promise<ConsentHistoryEntry[]> {
  return all<ConsentHistoryEntry>(
    db,
    `SELECT id, status, at, method, ip, source, reference_note FROM client_consents WHERE client_id = ? AND kind = 'digital_documents' ORDER BY id DESC`,
    clientId,
  );
}

export type ManualConsentSource = 'signed_contract' | 'other';

export interface ManualConsentInput {
  granted: boolean;
  source: ManualConsentSource;
  date: string;
  note?: string | null;
}

/** Consent captured on the client create/edit form (method 'manual'), not by a client-facing link. */
export function manualConsentStatement(db: D1Database, clientId: number, input: ManualConsentInput): D1PreparedStatement {
  return stmt(
    db,
    `INSERT INTO client_consents (client_id, kind, status, method, at, source, reference_note)
     VALUES (?, 'digital_documents', ?, 'manual', ?, ?, ?)`,
    clientId,
    input.granted ? 'granted' : 'revoked',
    `${input.date}T00:00:00.000Z`,
    input.granted ? input.source : null,
    input.note ?? null,
  );
}

export interface ManualConsentState extends ConsentState {
  method: string | null;
  source: string | null;
}

/** Latest consent event, including method and source, for display on the client page. */
export async function manualConsentDetail(db: D1Database, clientId: number): Promise<ManualConsentState> {
  const row = await first<ConsentRow & { method: string | null; source: string | null }>(
    db,
    `SELECT status, at, method, source FROM client_consents WHERE client_id = ? AND kind = 'digital_documents' ORDER BY id DESC LIMIT 1`,
    clientId,
  );
  return row ? { status: row.status, at: row.at, method: row.method, source: row.source } : { status: 'none', at: null, method: null, source: null };
}
