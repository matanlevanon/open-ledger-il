import PostalMime from 'postal-mime';
import { type AuditActor, auditStatement } from '../../core/audit';
import { all, first, stmt, transaction } from '../../core/db';
import type { Env } from '../../env';
import { isDemo } from '../demo/config';
import { htmlToText } from './files';
import { ingestInboxFile, type Deps } from './service';

/**
 * R35: receipts forwarded by email (docs/expense-inbox.md).
 *
 * Two ways in, one parser. The gateway (tools/ledger-inbox in the public repo) POSTs the raw
 * message to /api/inbox, signed with INBOX_SECRET. A Ledger with a domain of its own can route an
 * address straight to its Worker's email() handler. Either way the envelope sender must be on the
 * allowed list, and each PDF or image attachment becomes one expense waiting for review.
 *
 * Every email lands in business 1. The inbox belongs to the install, not to one business.
 */

export const INBOX_KEYS = {
  id: 'expenses.inbox_id',
  address: 'expenses.inbox_address',
  gateway: 'expenses.inbox_gateway',
  enabled: 'expenses.inbox_enabled',
  senders: 'expenses.inbox_senders',
  gmail: 'expenses.inbox_gmail_confirmation',
} as const;

export const INBOX_BUSINESS_ID = 1;
export const SIGNATURE_WINDOW_S = 300;
const SIGNATURE_KEEP_MS = 10 * 60_000;
const SMALL_INLINE_IMAGE = 20 * 1024;
const GMAIL_CONFIRMATION_SENDER = 'forwarding-noreply@google.com';
const ACCEPTED: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heic',
};
const BY_EXTENSION: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heic' };

export const INBOX_ACTOR: AuditActor = { userId: null, email: 'inbox', role: 'system', ip: null, userAgent: null, businessId: INBOX_BUSINESS_ID };

export type InboxOutcome = 'expense' | 'duplicate' | 'ignored' | 'confirmation' | 'empty' | 'off';

export interface GmailConfirmation {
  code: string | null;
  link: string | null;
  at: string;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function setting(db: D1Database, key: string): Promise<string | null> {
  return (await first<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key))?.value ?? null;
}

export function settingStatement(db: D1Database, key: string, value: string): D1PreparedStatement {
  return stmt(
    db,
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value,
    new Date().toISOString(),
  );
}

/** On unless the owner turned it off. */
export async function inboxEnabled(db: D1Database): Promise<boolean> {
  return (await setting(db, INBOX_KEYS.enabled)) !== '0';
}

/** The comparable form of an address: lowercase, and Gmail's "+caf_=..." forwarding tag dropped. */
export function normaliseSender(address: string): string {
  const a = address.trim().toLowerCase().replace(/^<|>$/g, '');
  const at = a.lastIndexOf('@');
  if (at < 0) return a;
  return `${a.slice(0, at).split('+')[0]}${a.slice(at)}`;
}

/** The owner email and every owner and assistant of business 1, until the owner edits the list. */
export async function defaultSenders(env: Env): Promise<string[]> {
  const rows = await all<{ email: string }>(
    env.DB,
    `SELECT u.email FROM users u JOIN user_businesses ub ON ub.user_id = u.id
      WHERE ub.business_id = ? AND ub.role IN ('owner', 'assistant') AND u.active = 1 ORDER BY u.id`,
    INBOX_BUSINESS_ID,
  );
  const list = [env.OWNER_EMAIL ?? '', ...rows.map((r) => r.email)].map((e) => e.trim().toLowerCase()).filter(Boolean);
  return [...new Set(list)];
}

export async function allowedSenders(env: Env): Promise<string[]> {
  const stored = await setting(env.DB, INBOX_KEYS.senders);
  if (stored === null) return defaultSenders(env);
  try {
    const list = JSON.parse(stored) as unknown;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function gmailConfirmation(db: D1Database): Promise<GmailConfirmation | null> {
  const raw = await setting(db, INBOX_KEYS.gmail);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GmailConfirmation;
  } catch {
    return null;
  }
}

export async function recentEvents(db: D1Database, limit = 10) {
  return all<{ id: number; at: string; sender: string; subject: string | null; outcome: InboxOutcome; expense_id: number | null }>(
    db,
    'SELECT id, at, sender, subject, outcome, expense_id FROM inbox_events WHERE business_id = ? ORDER BY id DESC LIMIT ?',
    INBOX_BUSINESS_ID,
    limit,
  );
}

function eventStatement(db: D1Database, sender: string, subject: string | null, outcome: InboxOutcome, expenseId: number | null = null): D1PreparedStatement {
  return stmt(
    db,
    'INSERT INTO inbox_events (sender, subject, outcome, expense_id, business_id) VALUES (?, ?, ?, ?, ?)',
    sender.slice(0, 320),
    subject ? subject.slice(0, 200) : null,
    outcome,
    expenseId,
    INBOX_BUSINESS_ID,
  );
}

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

function sameText(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * True when the gateway signed this body with INBOX_SECRET in the last 5 minutes and the signature
 * was not seen before. A good signature is stored, so a replay within its window is refused.
 */
export async function verifyGatewayRequest(
  env: Env,
  headers: { get(name: string): string | null },
  body: ArrayBuffer,
  now = Date.now(),
): Promise<boolean> {
  const secret = env.INBOX_SECRET ?? '';
  const ts = Number(headers.get('X-Inbox-Timestamp') ?? '');
  const given = (headers.get('X-Inbox-Signature') ?? '').toLowerCase();
  const from = headers.get('X-Ledger-Envelope-From') ?? '';
  const bodyHash = hex(await crypto.subtle.digest('SHA-256', body));
  const want = secret ? await hmacHex(secret, `${ts}.${from}.${bodyHash}`) : '';
  const fresh = Number.isFinite(ts) && Math.abs(now / 1000 - ts) <= SIGNATURE_WINDOW_S;
  // Every check runs, so the time taken does not say which one failed.
  const good = sameText(given, want) && secret !== '' && fresh;
  if (!good) return false;
  const cutoff = new Date(now - SIGNATURE_KEEP_MS).toISOString();
  const [, inserted] = await env.DB.batch([
    env.DB.prepare('DELETE FROM inbox_signatures WHERE seen_at < ?').bind(cutoff),
    env.DB.prepare('INSERT OR IGNORE INTO inbox_signatures (signature, seen_at) VALUES (?, ?)').bind(given, new Date(now).toISOString()),
  ]);
  return (inserted?.meta.changes ?? 0) === 1;
}

// ---------------------------------------------------------------------------
// Parsing and the sender rule
// ---------------------------------------------------------------------------

function senderLine(name: string | undefined, address: string | undefined): string {
  const a = (address ?? '').trim();
  const n = (name ?? '').trim();
  return n && a ? `${n} <${a}>` : n || a || 'unknown sender';
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

function contentTypeOf(mimeType: string | undefined, filename: string | null | undefined): string | null {
  const mime = (mimeType ?? '').toLowerCase().split(';')[0]!.trim();
  if (ACCEPTED[mime]) return mime === 'image/jpg' ? 'image/jpeg' : mime === 'image/heif' ? 'image/heic' : mime;
  const ext = /\.([a-z0-9]+)$/i.exec(filename ?? '')?.[1]?.toLowerCase();
  return ext ? (BY_EXTENSION[ext] ?? null) : null;
}

const bytesOf = (content: ArrayBuffer | Uint8Array | string): ArrayBuffer =>
  typeof content === 'string'
    ? (enc.encode(content).buffer as ArrayBuffer)
    : content instanceof Uint8Array
      ? (content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer)
      : content;

export interface InboxResult {
  outcome: InboxOutcome;
  expenseIds: number[];
}

/** Reads one raw email from `envelopeFrom` and files what it holds. Never throws for a bad email. */
export async function processInboundEmail(env: Env, deps: Deps, raw: ArrayBuffer, envelopeFrom: string): Promise<InboxResult> {
  const db = env.DB;
  const from = normaliseSender(envelopeFrom);
  const email = await PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' });
  const subject = email.subject ?? null;

  if (!(await inboxEnabled(db))) {
    await transaction(db, [eventStatement(db, from, subject, 'off')]);
    return { outcome: 'off', expenseIds: [] };
  }

  // Gmail's forwarding check: accepted from this one sender, stored, and no expense.
  if (from === GMAIL_CONFIRMATION_SENDER) {
    const text = `${subject ?? ''}\n${email.text ?? ''}\n${email.html ? htmlToText(email.html) : ''}`;
    const code = /confirmation code:\s*(\d{6,12})/i.exec(text)?.[1] ?? /\(#(\d{6,12})\)/.exec(text)?.[1] ?? null;
    const link = /https:\/\/mail(?:-settings)?\.google\.com\/mail\/[^\s"'<>]+/i.exec(`${email.text ?? ''} ${email.html ?? ''}`)?.[0] ?? null;
    const value: GmailConfirmation = { code, link: link?.replace(/&amp;/g, '&') ?? null, at: new Date().toISOString() };
    await transaction(db, [settingStatement(db, INBOX_KEYS.gmail, JSON.stringify(value)), eventStatement(db, from, subject, 'confirmation')]);
    return { outcome: 'confirmation', expenseIds: [] };
  }

  const allowed = (await allowedSenders(env)).map(normaliseSender);
  if (!allowed.includes(from)) {
    await transaction(db, [eventStatement(db, from, subject, 'ignored')]);
    return { outcome: 'ignored', expenseIds: [] };
  }

  const who = senderLine(email.from?.name, email.from?.address);
  const note = `Email from ${who}${subject ? `: ${subject}` : ''}`.slice(0, 500);
  const files: { bytes: ArrayBuffer; filename: string; contentType: string; readAs?: { bytes: ArrayBuffer; contentType: string }; note: string }[] = [];
  for (const [i, att] of (email.attachments ?? []).entries()) {
    const type = contentTypeOf(att.mimeType, att.filename);
    if (!type) continue;
    const bytes = bytesOf(att.content);
    const inline = att.disposition === 'inline' || Boolean(att.contentId);
    if (type.startsWith('image/') && inline && bytes.byteLength < SMALL_INLINE_IMAGE) continue;
    files.push({ bytes, filename: att.filename || `attachment-${i + 1}${ACCEPTED[type]}`, contentType: type, note });
  }

  if (files.length === 0) {
    const text = (email.text ?? '').trim() || (email.html ? htmlToText(email.html) : '');
    if (!text && !email.html) {
      await transaction(db, [eventStatement(db, from, subject, 'empty')]);
      return { outcome: 'empty', expenseIds: [] };
    }
    const html = email.html ?? `<pre>${escapeHtml(email.text ?? '')}</pre>`;
    files.push({
      bytes: enc.encode(html).buffer as ArrayBuffer,
      filename: `email-${new Date().toISOString().slice(0, 10)}.html`,
      contentType: 'text/html',
      readAs: { bytes: enc.encode(`Subject: ${subject ?? ''}\nFrom: ${who}\n\n${text}`).buffer as ArrayBuffer, contentType: 'text/plain' },
      note: `From email text, check the amount. ${note}`.slice(0, 500),
    });
  }

  const ids: number[] = [];
  let created = 0;
  for (const f of files) {
    const r = await ingestInboxFile(env, deps, f, INBOX_ACTOR);
    if (r.kind === 'created') {
      created++;
      ids.push(r.expense.id);
      await transaction(db, [eventStatement(db, from, subject, 'expense', r.expense.id)]);
    } else {
      ids.push(r.expenseId);
      await transaction(db, [eventStatement(db, from, subject, 'duplicate', r.expenseId)]);
    }
  }
  return { outcome: created > 0 ? 'expense' : 'duplicate', expenseIds: ids };
}

export const MAX_EMAIL_BYTES = 20 * 1024 * 1024;

/** The parts of an Email Worker message this handler uses. */
export interface IncomingEmail {
  from: string;
  rawSize: number;
  raw: ReadableStream<Uint8Array>;
  setReject(reason: string): void;
}

/**
 * R35 task 3: a Ledger with a domain of its own. Email Routing sends an address such as
 * receipts@acme.co.il straight to this Worker. No gateway and no signature: Cloudflare delivers
 * it, and the same sender rule applies.
 */
export async function handleLedgerEmail(message: IncomingEmail, env: Env, deps: Deps): Promise<void> {
  if (!inboxAvailable(env)) return message.setReject('Unknown address');
  if (message.rawSize > MAX_EMAIL_BYTES) return message.setReject('Too large');
  let result: InboxResult;
  try {
    const raw = await new Response(message.raw).arrayBuffer();
    result = await processInboundEmail(env, deps, raw, message.from);
  } catch {
    return message.setReject('Temporary problem, try again later');
  }
  if (result.outcome === 'off') message.setReject('This inbox is off');
}

/** True where the inbox runs: never in the public demo. */
export function inboxAvailable(env: Env): boolean {
  return !isDemo(env);
}

/** Writes one audit row for a settings change. */
export function inboxAudit(db: D1Database, actor: AuditActor, action: string, details: unknown): D1PreparedStatement {
  return auditStatement(db, actor, action, 'settings', 'expenses.inbox', details);
}
