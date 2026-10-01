import { first } from '../../core/db';
import { NotFoundError, UnauthorizedError } from '../../core/errors';
import type { Env } from '../../env';
import { clientDisplayName } from '../clients/display';
import { getDoc } from '../documents/repo';
import { displayNumber } from '../documents/types';
import { allocationGate } from '../ita';
import { r2Key } from '../pdf';
import { SHARE_LINK_TTL_SECONDS } from './tokens';

/**
 * The short WhatsApp share link (/api/sending/public/d/<code>) and the page behind it. The code is
 * 23 characters: the document id and expiry (8 bytes) plus a truncated HMAC-SHA256 (9 bytes), under
 * SEND_LINK_KEY like the long tokens in tokens.ts. The page carries Open Graph tags, so WhatsApp
 * shows a preview with the business logo, the document title and the amount instead of a bare URL,
 * and a button opens the signed PDF.
 */

const CODE_PREFIX = 'share-d:';

function base64url(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const str = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

async function mac(env: Pick<Env, 'SEND_LINK_KEY'>, body: Uint8Array): Promise<Uint8Array> {
  if (!env.SEND_LINK_KEY) throw new UnauthorizedError('Share links are unavailable.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SEND_LINK_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const message = new Uint8Array([...new TextEncoder().encode(CODE_PREFIX), ...body]);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, message)).slice(0, 9);
}

/** A short share code for a document's client copy, valid for SHARE_LINK_TTL_SECONDS. */
export async function signShareCode(env: Pick<Env, 'SEND_LINK_KEY'>, documentId: number, now = Date.now()): Promise<{ code: string; exp: number }> {
  const exp = Math.floor(now / 1000) + SHARE_LINK_TTL_SECONDS;
  const body = new Uint8Array(8);
  const view = new DataView(body.buffer);
  view.setUint32(0, documentId);
  view.setUint32(4, exp);
  const sig = await mac(env, body);
  return { code: base64url(new Uint8Array([...body, ...sig])), exp };
}

/** The document id a share code points at. Throws on a forged, damaged or expired code. */
export async function verifyShareCode(env: Pick<Env, 'SEND_LINK_KEY'>, code: string): Promise<number> {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64url(code);
  } catch {
    throw new UnauthorizedError('This link is not valid.');
  }
  if (bytes.length !== 17) throw new UnauthorizedError('This link is not valid.');
  const body = bytes.slice(0, 8);
  const expected = await mac(env, body);
  let diff = 0;
  for (let i = 0; i < 9; i++) diff |= expected[i]! ^ bytes[8 + i]!;
  if (diff !== 0) throw new UnauthorizedError('This link is not valid.');
  const view = new DataView(body.buffer);
  if (view.getUint32(4) < Math.floor(Date.now() / 1000)) throw new UnauthorizedError('This link has expired.');
  return view.getUint32(0);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function money(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

/** The business name as printed on documents (Settings > Business). */
export async function senderName(db: D1Database): Promise<string> {
  const row = await first<{ name_en: string | null; name_he: string | null }>(db, 'SELECT name_en, name_he FROM business_profile WHERE id = 1');
  return row?.name_en?.trim() || row?.name_he?.trim() || 'Your supplier';
}

export interface ShareDoc {
  id: number;
  title: string;
  titleHe: string;
  clientName: string;
  amount: string;
  date: string;
  sender: string;
  hasLogo: boolean;
  pdfKey: string;
}

/** Everything the share page and the WhatsApp message need about a document. */
export async function shareDoc(db: D1Database, documentId: number): Promise<ShareDoc> {
  const doc = await getDoc(db, documentId);
  // Defense in depth: re-check CLAUDE.md rule 3 at delivery time, not only when the link was made.
  const gate = await allocationGate(db, doc.id);
  if (!gate.allowed || doc.number === null || doc.status === 'draft') throw new NotFoundError('Document');
  const type = await first<{ name_en: string; name_he: string | null }>(db, 'SELECT name_en, name_he FROM document_types WHERE code = ?', doc.type);
  const client = doc.client_id === null ? null : await first<{ name_en: string | null; name_he: string | null }>(db, 'SELECT name_en, name_he FROM clients WHERE id = ?', doc.client_id);
  const logo = await first<{ logo_r2_key: string | null }>(db, 'SELECT logo_r2_key FROM business_profile WHERE id = 1');
  const number = String(doc.number);
  return {
    id: doc.id,
    title: `${type?.name_en ?? displayNumber(doc.type, doc.number) ?? 'Document'} ${number}`,
    titleHe: `${type?.name_he ?? type?.name_en ?? ''} ${number}`,
    clientName: client ? clientDisplayName(client, 'en') : '',
    amount: money(Math.abs(doc.total_minor), doc.currency),
    date: `${doc.date.slice(8, 10)}/${doc.date.slice(5, 7)}/${doc.date.slice(0, 4)}`,
    sender: await senderName(db),
    hasLogo: Boolean(logo?.logo_r2_key),
    pdfKey: r2Key(doc.date, doc.series_id, doc.number, 'client'),
  };
}

/** The page WhatsApp previews and the client opens: who sent what, the amount and an Open button. */
export function sharePageHtml(d: ShareDoc, pageUrl: string, origin: string): string {
  const title = `${d.title} from ${d.sender}`;
  const description = [d.clientName, d.amount, d.date].filter(Boolean).join(' · ');
  const image = d.hasLogo ? `${origin}/api/sending/public/logo` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(d.sender)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(pageUrl)}">
${image ? `<meta property="og:image" content="${esc(image)}"><meta property="og:image:alt" content="${esc(d.sender)}">` : ''}
<meta name="robots" content="noindex, nofollow">
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f5f7;color:#111827}
main{max-width:420px;margin:12vh auto 0;padding:0 16px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px 24px;text-align:center}
img{width:72px;height:72px;border-radius:16px;object-fit:contain}
h1{font-size:20px;margin:16px 0 4px}p{margin:4px 0;color:#4b5563}.amount{font-size:22px;font-weight:700;color:#111827;margin:12px 0}
a.btn{display:block;margin-top:20px;padding:14px;border-radius:999px;background:#1d4ed8;color:#fff;text-decoration:none;font-weight:600}
a.dl{display:block;margin-top:10px;color:#1d4ed8;text-decoration:none;font-size:14px}
</style></head>
<body><main><div class="card">
${image ? `<img src="${esc(image)}" alt="">` : ''}
<h1>${esc(d.title)}</h1>
<p>${esc(d.sender)}</p>
${d.clientName ? `<p>To: ${esc(d.clientName)}</p>` : ''}
<div class="amount">${esc(d.amount)}</div>
<p>${esc(d.date)}</p>
<a class="btn" href="${esc(pageUrl)}/pdf">View document (PDF)</a>
<a class="dl" href="${esc(pageUrl)}/pdf?download=1">Download</a>
</div></main></body></html>`;
}

/** The WhatsApp message: a greeting, what the document is, who it is from and the short link. */
export function whatsappMessage(d: ShareDoc, url: string, hebrew: boolean): string {
  if (hebrew) return `שלום${d.clientName ? ` ${d.clientName}` : ''}, מצורף ${d.titleHe.trim()} מ-${d.sender}:\n${url}`;
  return `Hello${d.clientName ? ` ${d.clientName}` : ''}, here is your ${d.title} from ${d.sender}:\n${url}`;
}
