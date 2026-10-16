/**
 * ledger-inbox: an email gateway that turns forwarded receipts into Open Ledger IL expenses.
 *
 * Cloudflare Email Routing sends every address on the inbox domain to this Email Worker. The
 * local part names a Ledger install. The gateway checks the install's licence, signs the raw
 * message with the install's secret and POSTs it to <ledger>/api/inbox. It stores no message and
 * logs no content: the message passes through in memory.
 *
 * Email
 *   email(message)   Unknown address or a licence that is not active: reject "Unknown address".
 *                    Over 20 MB: reject "Too large". The Ledger answers 5xx or times out: reject
 *                    with a temporary-sounding reason. The Ledger answers 4xx: reject for good.
 *
 * Routes
 *   POST /register   JSON { origin, licence, accountId, taxId }. The installer calls it. Checks
 *                    the licence with the licence service. Returns { inboxId, address, secret }.
 *                    A second call for the same licence keeps the inbox and makes a new secret.
 *   POST /rotate     JSON { inboxId, timestamp }, header X-Inbox-Signature: HMAC-SHA256 of
 *                    "<timestamp>.<body>" with the current secret, hex. Makes a new inbox id at
 *                    once. Returns { inboxId, address }.
 *   GET  /health
 *
 * The request to the Ledger
 *   POST <origin>/api/inbox, body the raw message (message/rfc822), headers:
 *   X-Inbox-Id, X-Inbox-Timestamp (seconds), X-Ledger-Envelope-From (message.from), and
 *   X-Inbox-Signature: HMAC-SHA256 hex of "<timestamp>.<envelope from>.<SHA-256 hex of the body>".
 *
 * Bindings and variables
 *   DB                          D1 with the inboxes table (migrations/0001_inboxes.sql)
 *   INBOX_DOMAIN                the domain the addresses live on, for example in.example.com
 *   INBOX_PREFIX                optional, for example expenses: addresses become expenses+<id>@domain,
 *                               so one Email Routing rule with subaddressing on covers them all
 *   LICENCE_URL, LICENCE_SECRET the licence service (/licence/activate, /licence/check)
 */

export const MAX_BYTES = 20 * 1024 * 1024;
const LICENCE_TTL_MS = 10 * 60_000;
const LEDGER_TIMEOUT_MS = 30_000;
const ROTATE_WINDOW_S = 300;
const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const fail = (status, message) => json(status, { inbox_error: message });

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function sha256Hex(data) {
  return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
}

export async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

function sameText(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** 10 characters of lowercase Crockford base32: 50 random bits. */
export function newInboxId() {
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  let bits = 0n;
  for (const b of bytes) bits = (bits << 8n) | BigInt(b);
  bits &= (1n << 50n) - 1n;
  let out = '';
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return out;
}

const newSecret = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const domainOf = (env) => (env.INBOX_DOMAIN ?? '').trim().toLowerCase();
const prefixOf = (env) => (env.INBOX_PREFIX ?? '').trim().toLowerCase();
const addressOf = (env, inboxId) => (prefixOf(env) ? `${prefixOf(env)}+${inboxId}@${domainOf(env)}` : `${inboxId}@${domainOf(env)}`);

/** The inbox id from a recipient: <id>@domain, or <prefix>+<id>@domain. */
export function inboxIdOf(env, to) {
  const local = String(to ?? '').split('@')[0].trim().toLowerCase();
  const prefix = prefixOf(env);
  if (prefix && local.startsWith(`${prefix}+`)) return local.slice(prefix.length + 1);
  return local.includes('+') ? '' : local;
}

function licenceService(env) {
  const url = (env.LICENCE_URL ?? '').trim().replace(/\/+$/, '');
  const secret = (env.LICENCE_SECRET ?? '').trim();
  return url && secret ? { url, secret } : null;
}

async function callLicence(svc, path, payload) {
  const res = await fetch(`${svc.url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shop-Secret': svc.secret },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** Licence answers per inbox row: { ok, at }. In memory, per isolate, 10 minutes. */
const licenceCache = new Map();

/** True, false, or throws when the licence service does not answer and nothing is cached. */
async function licenceOk(env, row) {
  const svc = licenceService(env);
  if (!svc) return false;
  const cached = licenceCache.get(row.id);
  if (cached && Date.now() - cached.at < LICENCE_TTL_MS) return cached.ok;
  try {
    const r = await callLicence(svc, '/licence/check', { licenceId: row.licence_id, accountId: row.account_id, taxId: row.tax_id, client: `inbox-${row.id}`, calls: 0 });
    const ok = r.status === 200 && r.body?.ok === true;
    licenceCache.set(row.id, { ok, at: Date.now() });
    return ok;
  } catch {
    if (cached) return cached.ok;
    throw new Error('licence service unreachable');
  }
}

async function register(env, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'Send a JSON body with origin and licence.');
  }
  const svc = licenceService(env);
  if (!svc || !domainOf(env)) return fail(503, 'This gateway is not set up.');
  const licenceKey = String(body?.licence ?? '').trim();
  if (!licenceKey) return fail(401, 'Send a licence key.');
  let origin;
  try {
    const u = new URL(String(body?.origin ?? ''));
    if (u.protocol !== 'https:') throw new Error('not https');
    origin = u.origin;
  } catch {
    return fail(400, 'origin must be the install address, starting with https://.');
  }
  const accountId = String(body?.accountId ?? '').trim().toLowerCase();
  const taxId = String(body?.taxId ?? '').trim();
  let r;
  try {
    r = await callLicence(svc, '/licence/activate', { key: licenceKey, accountId, taxId, origin });
  } catch {
    return fail(502, 'The licence service did not answer. Try again in a minute.');
  }
  if (r.status !== 200 || !r.body?.ok) {
    console.log(`register licence refused ${r.status}`);
    return json(r.status >= 400 && r.status < 500 ? r.status : 502, { inbox_error: String(r.body?.message ?? 'The licence was refused.') });
  }
  const licenceId = Number(r.body.licenceId);
  const secret = newSecret();
  const existing = await env.DB.prepare('SELECT id, inbox_id, paused_at FROM inboxes WHERE licence_id = ?').bind(licenceId).first();
  if (existing) {
    if (existing.paused_at) return fail(403, 'This inbox is paused.');
    await env.DB.prepare('UPDATE inboxes SET secret = ?, ledger_origin = ?, account_id = ?, tax_id = ? WHERE id = ?').bind(secret, origin, accountId, taxId, existing.id).run();
    licenceCache.delete(existing.id);
    console.log(`register inbox=${existing.id} new secret`);
    return json(200, { inboxId: existing.inbox_id, address: addressOf(env, existing.inbox_id), secret, renewed: true });
  }
  const inboxId = await freeInboxId(env);
  await env.DB.prepare('INSERT INTO inboxes (inbox_id, ledger_origin, secret, licence_id, account_id, tax_id) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(inboxId, origin, secret, licenceId, accountId, taxId)
    .run();
  console.log('register inbox new');
  return json(201, { inboxId, address: addressOf(env, inboxId), secret });
}

async function freeInboxId(env) {
  for (;;) {
    const id = newInboxId();
    if (!(await env.DB.prepare('SELECT 1 FROM inboxes WHERE inbox_id = ?').bind(id).first())) return id;
  }
}

async function rotate(env, request) {
  const text = await request.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, 'Send a JSON body with inboxId and timestamp.');
  }
  const row = await env.DB.prepare('SELECT id, secret, paused_at FROM inboxes WHERE inbox_id = ?').bind(String(body?.inboxId ?? '').toLowerCase()).first();
  const ts = Number(body?.timestamp);
  const given = request.headers.get('X-Inbox-Signature') ?? '';
  const fresh = Number.isFinite(ts) && Math.abs(Date.now() / 1000 - ts) <= ROTATE_WINDOW_S;
  if (!row || row.paused_at || !fresh || !sameText(given, await hmacHex(row.secret, `${ts}.${text}`))) return fail(401, 'Unknown inbox or bad signature.');
  const inboxId = await freeInboxId(env);
  await env.DB.prepare('UPDATE inboxes SET inbox_id = ? WHERE id = ?').bind(inboxId, row.id).run();
  console.log(`rotate inbox=${row.id}`);
  return json(200, { inboxId, address: addressOf(env, inboxId) });
}

/** Handles one incoming email. Never logs a subject, an address or any content. */
export async function handleEmail(message, env, fetchFn = fetch) {
  if (Number(message.rawSize ?? 0) > MAX_BYTES) {
    console.log('email too-large');
    return message.setReject('Too large');
  }
  const local = inboxIdOf(env, message.to);
  const row = local ? await env.DB.prepare('SELECT * FROM inboxes WHERE inbox_id = ? AND paused_at IS NULL').bind(local).first() : null;
  if (!row) {
    console.log('email unknown-address');
    return message.setReject('Unknown address');
  }
  let ok;
  try {
    ok = await licenceOk(env, row);
  } catch {
    console.log(`email inbox=${row.id} licence-unreachable`);
    return message.setReject('Temporary problem, try again later');
  }
  if (!ok) {
    console.log(`email inbox=${row.id} licence-inactive`);
    return message.setReject('Unknown address');
  }
  const raw = await new Response(message.raw).arrayBuffer();
  if (raw.byteLength > MAX_BYTES) {
    console.log(`email inbox=${row.id} too-large`);
    return message.setReject('Too large');
  }
  const from = String(message.from ?? '');
  const ts = Math.floor(Date.now() / 1000);
  const signature = await hmacHex(row.secret, `${ts}.${from}.${await sha256Hex(raw)}`);
  let res;
  try {
    res = await fetchFn(`${row.ledger_origin}/api/inbox`, {
      method: 'POST',
      headers: {
        'Content-Type': 'message/rfc822',
        'X-Inbox-Id': row.inbox_id,
        'X-Inbox-Timestamp': String(ts),
        'X-Inbox-Signature': signature,
        'X-Ledger-Envelope-From': from,
      },
      body: raw,
      signal: AbortSignal.timeout(LEDGER_TIMEOUT_MS),
    });
  } catch {
    console.log(`email inbox=${row.id} ledger-unreachable`);
    return message.setReject('Temporary problem, try again later');
  }
  console.log(`email inbox=${row.id} ledger=${res.status} ${raw.byteLength}B`);
  if (res.status >= 500) return message.setReject('Temporary problem, try again later');
  if (res.status >= 400) return message.setReject('Refused by the Ledger');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json(200, { ok: true, service: 'ledger-inbox' });
      if (request.method === 'POST' && url.pathname === '/register') return await register(env, request);
      if (request.method === 'POST' && url.pathname === '/rotate') return await rotate(env, request);
      return fail(404, 'Not found.');
    } catch (err) {
      console.log(`error ${err instanceof Error ? err.name : 'Error'}`);
      return fail(500, 'Gateway error.');
    }
  },
  async email(message, env) {
    await handleEmail(message, env);
  },
};
