/**
 * ita-auth: an ITA login broker for Open Ledger IL installs that share one ITA API app.
 *
 * The app's client secret lives only here, as a Worker secret. Each Ledger install is a client
 * of this broker: it sends its users to /authorize for the ITA sign-in, and it calls /token to
 * trade the one-time code for tokens and to renew them. From Open Ledger IL 1.6.0 its invoice
 * calls pass here too, through /ita/*, with its own access token. The broker checks the install
 * on every call and forwards it, through the relay when one is set.
 *
 * Routes
 *   GET  /authorize?client=<name>&environment=<sandbox|production>&state=<ledger state>
 *        Redirects the browser to the ITA sign-in. The ITA returns to /callback.
 *   GET  /callback?code=...&state=...
 *        Checks the signed state and sends the browser to <client origin>/api/ita/callback.
 *   POST /token   headers X-Ita-Broker-Client and X-Ita-Broker-Key, form body
 *        grant_type=authorization_code&code=...&environment=...
 *        grant_type=refresh_token&refresh_token=...&environment=...
 *        Adds the client credentials and returns the ITA reply as it came, status included.
 *   POST /register  header X-Ita-Broker-Admin, JSON body { origin, business }
 *        or JSON body { origin, business, licence, accountId, taxId } with no header, checked
 *        with the licence service (LICENCE_URL) when one is set.
 *        Adds a Ledger install, or gives an existing one a new key. Returns { name, key }. The
 *        installer calls this, so nobody creates keys by hand.
 *   GET|POST /ita/<openapi|ita-api>/shaam/<env>/...   headers X-Ita-Client and X-Ita-Client-Key
 *        Forwards a Tax Authority call for an active install with a good licence, same path,
 *        three headers (Authorization, Content-Type, Accept), no redirects. Bodies never logged.
 *   GET  /admin, POST /admin/clients/<name>/pause | resume
 *        The client list, behind Cloudflare Access. Pause blocks a client at once and keeps its row.
 *   GET  /health
 *
 * Bindings, secrets and variables (see README.md)
 *   DB                              D1 database with the clients table (migrations/0001_clients.sql)
 *   PUBLIC_URL                      optional, this Worker's own address. Default: the request's own.
 *   STATE_SECRET                    32 random bytes, base64. Signs the login state.
 *   REGISTER_SECRET                 32 random bytes, base64. Lets the installer add clients.
 *   ACCESS_TEAM_DOMAIN, ACCESS_AUD, ADMIN_EMAILS   the Access app in front of /admin
 *   ITA_CLIENT_ID_PRODUCTION, ITA_CLIENT_SECRET_PRODUCTION   (and _SANDBOX, optional)
 *   ITA_RELAY_URL, ITA_RELAY_CLIENT_ID, ITA_RELAY_CLIENT_SECRET   optional Israeli relay
 *   LICENCE_URL, LICENCE_SECRET     optional licence service (/licence/activate, /licence/check)
 *
 * Errors the broker itself raises use the key broker_error, never error, so a Ledger route
 * check never mistakes them for a reply from the ITA. Tokens are never logged.
 */

const ITA = {
  sandbox: {
    authorize: 'https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/authorize',
    token: 'https://ita-api.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/token',
  },
  production: {
    authorize: 'https://openapi.taxes.gov.il/shaam/production/longtimetoken/oauth2/authorize',
    token: 'https://ita-api.taxes.gov.il/shaam/production/longtimetoken/oauth2/token',
  },
};
// SHAAM's notice of 21.10.2026: from 01.11.2026 the invoice services take invoices_scope. Until then
// a refresh refused with the new scope (400) is tried once more with the old literal "scope".
const SCOPE = 'invoices_scope';
const LEGACY_SCOPE = 'scope';
const SCOPE_CUTOVER = '2026-11-01';
const israelDay = (now) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const scopesFor = (now) => (israelDay(now) < SCOPE_CUTOVER ? [SCOPE, LEGACY_SCOPE] : [SCOPE]);
const STATE_TTL_MS = 15 * 60_000;
const RELAY_HOSTS = { 'openapi.taxes.gov.il': 'openapi', 'ita-api.taxes.gov.il': 'ita-api' };

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const fail = (status, message) => json(status, { broker_error: message });

/** This Worker's own address. PUBLIC_URL wins over the address the request came in on. */
function publicUrl(env, requestUrl) {
  return ((env.PUBLIC_URL ?? '').trim() || new URL(requestUrl).origin).replace(/\/+$/, '');
}

function db(env) {
  if (!env.DB) throw new Error('Bind the ita-auth-clients D1 database as DB.');
  return env.DB;
}

/** An active Ledger install allowed to use the broker: { name, origin, key_sha256 }, or null. */
async function findClient(env, name) {
  if (!name || name.length > 80) return null;
  return db(env).prepare("SELECT name, origin, key_sha256 FROM clients WHERE name = ? AND status = 'active'").bind(name).first();
}

function credentials(env, environment) {
  if (environment !== 'sandbox' && environment !== 'production') return null;
  const suffix = environment.toUpperCase();
  const id = (env[`ITA_CLIENT_ID_${suffix}`] ?? '').trim();
  const secret = (env[`ITA_CLIENT_SECRET_${suffix}`] ?? '').trim();
  return id && secret ? { id, secret } : null;
}

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));

async function hmacKey(env) {
  const raw = (env.STATE_SECRET ?? '').trim();
  if (raw.length < 32) throw new Error('Set STATE_SECRET to 32 random bytes, base64.');
  return crypto.subtle.importKey('raw', enc.encode(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signState(env, payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

async function readState(env, signed) {
  const [body, sig] = String(signed ?? '').split('.');
  if (!body || !sig) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(env), fromB64url(sig), enc.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return typeof payload.x === 'number' && payload.x > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Same rule as the Ledger's relayedFetch: ITA hosts go through the relay when one is set. */
function itaFetch(env) {
  const relay = (env.ITA_RELAY_URL ?? '').trim().replace(/\/+$/, '');
  if (!relay) return fetch;
  const id = (env.ITA_RELAY_CLIENT_ID ?? '').trim();
  const secret = (env.ITA_RELAY_CLIENT_SECRET ?? '').trim();
  if (!id || !secret) throw new Error('ITA_RELAY_URL is set. Set ITA_RELAY_CLIENT_ID and ITA_RELAY_CLIENT_SECRET too.');
  return (input, init) => {
    const url = new URL(input);
    const prefix = RELAY_HOSTS[url.hostname];
    if (!prefix) return fetch(input, init);
    const headers = new Headers(init?.headers);
    headers.set('CF-Access-Client-Id', id);
    headers.set('CF-Access-Client-Secret', secret);
    return fetch(`${relay}/${prefix}${url.pathname}${url.search}`, { ...init, headers });
  };
}

async function authorize(env, url) {
  const client = await findClient(env, url.searchParams.get('client') ?? '');
  const environment = url.searchParams.get('environment') ?? '';
  const state = url.searchParams.get('state') ?? '';
  if (!client) return fail(403, 'Unknown client.');
  const creds = credentials(env, environment);
  if (!creds) return fail(400, 'Unknown environment, or no ITA app set up for it.');
  if (!state || state.length > 200) return fail(400, 'Missing or oversized state.');
  const signed = await signState(env, { c: client.name, e: environment, s: state, x: Date.now() + STATE_TTL_MS });
  const target = new URL(ITA[environment].authorize);
  target.searchParams.set('response_type', 'code');
  target.searchParams.set('client_id', creds.id);
  target.searchParams.set('scope', SCOPE);
  target.searchParams.set('redirect_uri', `${publicUrl(env, url)}/callback`);
  target.searchParams.set('state', signed);
  console.log(`authorize client=${client.name} env=${environment}`);
  return Response.redirect(target.toString(), 302);
}

async function callback(env, url) {
  const payload = await readState(env, url.searchParams.get('state'));
  if (!payload) return fail(400, 'The sign-in link expired or was changed. Start again from the Ledger.');
  const client = await findClient(env, payload.c);
  if (!client) return fail(403, 'Unknown client.');
  const back = new URL('/api/ita/callback', client.origin);
  back.searchParams.set('state', payload.s);
  const code = url.searchParams.get('code');
  if (code && !url.searchParams.get('error')) back.searchParams.set('code', code);
  else back.searchParams.set('error', url.searchParams.get('error') || 'access_denied');
  console.log(`callback client=${client.name} env=${payload.e} ${code ? 'code' : 'no-code'}`);
  return Response.redirect(back.toString(), 302);
}

async function token(env, request) {
  const name = request.headers.get('X-Ita-Broker-Client') ?? '';
  const key = request.headers.get('X-Ita-Broker-Key') ?? '';
  const client = await findClient(env, name);
  if (!client || !key || !sameText(await sha256Hex(key), client.key_sha256.toLowerCase())) return fail(401, 'Unknown client or wrong key.');
  await db(env).prepare("UPDATE clients SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE name = ?").bind(client.name).run();

  const form = new URLSearchParams(await request.text());
  const environment = form.get('environment') ?? '';
  const creds = credentials(env, environment);
  if (!creds) return fail(400, 'Unknown environment, or no ITA app set up for it.');

  const grant = form.get('grant_type') ?? '';
  // The install's scope when it is one the ITA takes today, else the new one. An older install still
  // sends "scope": it keeps working until 01.11.2026 and gets the new scope from then on.
  const allowed = scopesFor(new Date());
  const scope = allowed.includes(form.get('scope') ?? '') ? form.get('scope') : SCOPE;
  let body;
  if (grant === 'authorization_code' && form.get('code')) {
    body = { grant_type: grant, code: form.get('code'), redirect_uri: `${publicUrl(env, request.url)}/callback`, scope };
  } else if (grant === 'refresh_token' && form.get('refresh_token')) {
    // The ITA developer guide sends the client credentials in the refresh body too.
    body = { grant_type: grant, refresh_token: form.get('refresh_token'), scope, client_id: creds.id, client_secret: creds.secret };
  } else {
    return fail(400, 'Send grant_type authorization_code with code, or refresh_token with refresh_token.');
  }

  const started = Date.now();
  let res;
  try {
    res = await itaFetch(env)(ITA[environment].token, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${creds.id}:${creds.secret}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    console.log(`token client=${client.name} env=${environment} grant=${grant} upstream-error ${err?.name ?? 'Error'}`);
    return fail(502, 'The ITA token address did not answer.');
  }
  const text = await res.text();
  console.log(`token client=${client.name} env=${environment} grant=${grant} scope=${scope} ${res.status} ${Date.now() - started}ms`);
  return new Response(text, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ---------------------------------------------------------------------------
// Tax Authority calls from installs, forwarded with the same rules as tools/ita-relay
// ---------------------------------------------------------------------------

const ITA_TARGETS = { openapi: 'https://openapi.taxes.gov.il', 'ita-api': 'https://ita-api.taxes.gov.il' };
const ITA_PATH_RE = /^\/ita\/(openapi|ita-api)(\/shaam\/(?:tsandbox|production)\/[A-Za-z0-9._~\-/]+)$/;
const ITA_PASS_HEADERS = ['authorization', 'content-type', 'accept'];
const LICENCE_TTL_MS = 10 * 60_000;
const MAX_ITA_BODY = 1_000_000;

/** Licence answers per client name: { ok, at }. In memory, per isolate, 10 minutes. */
const licenceCache = new Map();
/** /ita/* calls per client since its last licence check, reported to the licence service as usage. */
const callsSince = new Map();

/** True when the client's licence is still good. A client with no licence id needs no check. */
async function licenceOk(env, client) {
  if (!client.licence_id) return true;
  const svc = licenceService(env);
  if (!svc) return true;
  const cached = licenceCache.get(client.name);
  if (cached && Date.now() - cached.at < LICENCE_TTL_MS) return cached.ok;
  const calls = callsSince.get(client.name) ?? 0;
  try {
    const r = await callLicence(svc, '/licence/check', { licenceId: client.licence_id, accountId: client.account_id, taxId: client.tax_id, client: client.name, calls });
    const ok = r.status === 200 && r.body?.ok === true;
    licenceCache.set(client.name, { ok, at: Date.now() });
    // Reported, so these calls are not counted again. Calls made during the check stay counted.
    if (r.status === 200) callsSince.set(client.name, Math.max(0, (callsSince.get(client.name) ?? 0) - calls));
    return ok;
  } catch {
    // The licence service is down: keep the last answer, if there is one, rather than stop invoices.
    if (cached) return cached.ok;
    throw new Error('licence service unreachable');
  }
}

async function itaProxy(env, request, url) {
  const name = request.headers.get('X-Ita-Client') ?? '';
  const key = request.headers.get('X-Ita-Client-Key') ?? '';
  const client = name && name.length <= 80
    ? await db(env).prepare("SELECT name, key_sha256, licence_id, account_id, tax_id FROM clients WHERE name = ? AND status = 'active'").bind(name).first()
    : null;
  if (!client || !key || !sameText(await sha256Hex(key), client.key_sha256.toLowerCase())) return fail(401, 'Unknown client, wrong key or paused install.');
  let ok;
  try {
    ok = await licenceOk(env, client);
  } catch {
    return fail(503, 'The licence service did not answer. Try again in a minute.');
  }
  if (!ok) return fail(403, 'The licence for this install is not active. Contact the person who set it up.');

  const m = ITA_PATH_RE.exec(url.pathname);
  if (!m || url.pathname.includes('..')) return fail(404, 'Not a Tax Authority path.');
  if (request.method !== 'GET' && request.method !== 'POST') return fail(405, 'GET and POST only.');
  const headers = new Headers();
  for (const h of ITA_PASS_HEADERS) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  let body;
  if (request.method === 'POST') {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_ITA_BODY) return fail(413, 'Body too large.');
  }
  await db(env).prepare(`UPDATE clients SET last_seen_at = ${NOW} WHERE name = ?`).bind(client.name).run();
  if (client.licence_id) callsSince.set(client.name, (callsSince.get(client.name) ?? 0) + 1);
  const started = Date.now();
  let res;
  try {
    res = await itaFetch(env)(`${ITA_TARGETS[m[1]]}${m[2]}${url.search}`, { method: request.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    console.log(`ita client=${client.name} ${request.method} ${m[1]}${m[2]} upstream-error ${err?.name ?? 'Error'}`);
    return fail(502, 'The Tax Authority did not answer the broker.');
  }
  const out = await res.arrayBuffer();
  // Path and status only. Never the body, never a header value.
  console.log(`ita client=${client.name} ${request.method} ${m[1]}${m[2]} ${res.status} ${out.byteLength}B ${Date.now() - started}ms`);
  return new Response(out, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream', 'Cache-Control': 'no-store' } });
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const slug = (host) => host.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'ledger';

/** The licence service, when LICENCE_URL and LICENCE_SECRET are both set. Null otherwise. */
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
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/**
 * The installer adds a Ledger install here. The key is made here and returned once.
 * Two ways in: the admin secret (REGISTER_SECRET), or a licence key with the Cloudflare account
 * id and the business tax number, checked with the licence service when one is set.
 */
async function register(env, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'Send a JSON body with origin and business.');
  }
  const secret = (env.REGISTER_SECRET ?? '').trim();
  const given = request.headers.get('X-Ita-Broker-Admin') ?? '';
  const admin = secret.length >= 32 && given !== '' && sameText(await sha256Hex(given), await sha256Hex(secret));
  if (given && !admin) return fail(401, 'Wrong or missing admin secret.');
  const svc = licenceService(env);
  const licenceKey = String(body?.licence ?? '').trim();
  if (!admin && !licenceKey) return fail(secret.length >= 32 || svc ? 401 : 503, secret.length >= 32 || svc ? 'Send a licence key or the admin secret.' : 'Registration is not set up on this broker.');
  if (!admin && !svc) return fail(503, 'Licence keys are not set up on this broker.');
  let licence = null;
  if (licenceKey && svc) {
    const accountId = String(body?.accountId ?? '').trim().toLowerCase();
    const taxId = String(body?.taxId ?? '').trim();
    let r;
    try {
      r = await callLicence(svc, '/licence/activate', { key: licenceKey, accountId, taxId, origin: String(body?.origin ?? '') });
    } catch {
      return fail(502, 'The licence service did not answer. Try again in a minute.');
    }
    if (r.status !== 200 || !r.body?.ok) {
      console.log(`register licence refused ${r.status} ${String(r.body?.error ?? '').slice(0, 40)}`);
      return json(r.status >= 400 && r.status < 500 ? r.status : 502, { broker_error: String(r.body?.message ?? 'The licence was refused.'), error: r.body?.error ?? 'licence_refused' });
    }
    licence = { id: Number(r.body.licenceId), last4: licenceKey.replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase(), accountId, taxId };
  }
  let origin;
  try {
    const u = new URL(String(body?.origin ?? ''));
    if (u.protocol !== 'https:') throw new Error('not https');
    origin = u.origin;
  } catch {
    return fail(400, 'origin must be the install address, starting with https://.');
  }
  const business = String(body?.business ?? '').trim().slice(0, 200) || null;
  const key = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await sha256Hex(key);
  const d = db(env);

  const lic = licence ?? { id: null, last4: null, accountId: null, taxId: null };
  const existing = await d.prepare('SELECT name, status FROM clients WHERE origin = ?').bind(origin).first();
  if (existing) {
    if (existing.status !== 'active') return fail(403, 'This install is paused. Resume it on the broker admin page first.');
    await d.batch([
      d.prepare(
        `UPDATE clients SET key_sha256 = ?, business = COALESCE(?, business), licence_id = COALESCE(?, licence_id), licence_last4 = COALESCE(?, licence_last4),
         account_id = COALESCE(?, account_id), tax_id = COALESCE(?, tax_id), updated_at = ${NOW} WHERE name = ?`,
      ).bind(hash, business, lic.id, lic.last4, lic.accountId, lic.taxId, existing.name),
      d.prepare("INSERT INTO client_events (client, action, by) VALUES (?, 'key renewed', 'installer')").bind(existing.name),
    ]);
    licenceCache.delete(existing.name);
    console.log(`register client=${existing.name} renewed`);
    return json(200, { name: existing.name, key, renewed: true });
  }
  const base = slug(new URL(origin).hostname);
  let name = base;
  for (let i = 2; await d.prepare('SELECT 1 FROM clients WHERE name = ?').bind(name).first(); i++) name = `${base}-${i}`;
  await d.batch([
    d.prepare('INSERT INTO clients (name, origin, business, key_sha256, licence_id, licence_last4, account_id, tax_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
      name,
      origin,
      business,
      hash,
      lic.id,
      lic.last4,
      lic.accountId,
      lic.taxId,
    ),
    d.prepare("INSERT INTO client_events (client, action, by) VALUES (?, 'registered', 'installer')").bind(name),
  ]);
  console.log(`register client=${name} new`);
  return json(201, { name, key });
}

const dec = new TextDecoder();

/** The signed-in admin's email from the Cloudflare Access token, or null. Checks the signature. */
async function accessEmail(env, request) {
  const team = (env.ACCESS_TEAM_DOMAIN ?? '').trim().replace(/\/+$/, '');
  const aud = (env.ACCESS_AUD ?? '').trim();
  const admins = (env.ADMIN_EMAILS ?? '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!team || !aud || !admins.length) return null;
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion') ?? '';
  const [h, p, sig] = jwt.split('.');
  if (!h || !p || !sig) return null;
  try {
    const header = JSON.parse(dec.decode(fromB64url(h)));
    const payload = JSON.parse(dec.decode(fromB64url(p)));
    const certs = await (await fetch(`${team}/cdn-cgi/access/certs`)).json();
    const jwk = (certs.keys ?? []).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(sig), enc.encode(`${h}.${p}`)))) return null;
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(aud) || !(payload.exp * 1000 > Date.now())) return null;
    const email = String(payload.email ?? '').toLowerCase();
    return admins.includes(email) ? email : null;
  } catch {
    return null;
  }
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

async function adminPage(env, email) {
  const { results } = await db(env).prepare('SELECT name, origin, business, status, created_at, last_seen_at, licence_last4 FROM clients ORDER BY created_at DESC').all();
  const day = (t) => (t ? esc(String(t).slice(0, 10)) : 'never');
  const rows = (results ?? []).map((c) => `<tr class="${c.status}">
  <td><b>${esc(c.business || c.name)}</b><br><span>${esc(c.name)}</span></td>
  <td><a href="${esc(c.origin)}" target="_blank" rel="noopener">${esc(new URL(c.origin).hostname)}</a></td>
  <td>${c.status === 'active' ? 'Active' : 'Paused'}</td><td>${c.licence_last4 ? `…${esc(c.licence_last4)}` : 'no licence'}</td>
  <td>${day(c.created_at)}</td><td>${day(c.last_seen_at)}</td>
  <td><form method="post" action="/admin/clients/${encodeURIComponent(c.name)}/${c.status === 'active' ? 'pause' : 'resume'}">
  <button>${c.status === 'active' ? 'Pause' : 'Resume'}</button></form></td></tr>`).join('');
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ita-auth clients</title><style>
body{margin:0;font:15px/1.5 "Segoe UI",system-ui,sans-serif;background:#f6f5f2;color:#1d1d1b}main{max-width:960px;margin:0 auto;padding:28px 16px}
h1{font-size:22px;margin:0 0 4px}p{color:#6b6a66;margin:0 0 18px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3e1db;border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #e3e1db;font-size:14px;vertical-align:top}th{font-size:12px;color:#6b6a66;font-weight:600}
td span{color:#6b6a66;font-size:12px}tr.paused td{color:#6b6a66}button{font:inherit;font-size:13px;border-radius:8px;padding:5px 12px;border:1px solid #e3e1db;background:#fff;cursor:pointer}
tr.active button{border-color:#c0362c;color:#c0362c}a{color:#1f5fd1}.top{display:flex;justify-content:space-between;align-items:baseline;gap:12px}a.out{font-size:14px;border:1px solid #e3e1db;border-radius:8px;padding:5px 12px;background:#fff;text-decoration:none;color:#1d1d1b}@media(max-width:640px){th:nth-child(5),td:nth-child(5){display:none}}</style></head>
<body><main><div class="top"><h1>Login broker clients</h1><a class="out" href="/cdn-cgi/access/logout">Sign out</a></div><p>Signed in as ${esc(email)}. Pause blocks a client at once. Resume brings it back with the same key.</p>
<table><thead><tr><th>Business</th><th>Address</th><th>Status</th><th>Licence</th><th>Added</th><th>Last used</th><th></th></tr></thead>
<tbody>${rows || '<tr><td colspan="7">No clients yet. The installer adds them.</td></tr>'}</tbody></table></main></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' },
  });
}

async function setStatus(env, request, url, email, name, action) {
  // The page posts to itself. A post from anywhere else is refused.
  if (request.headers.get('Origin') !== publicUrl(env, url)) return fail(403, 'Wrong origin.');
  const status = action === 'pause' ? 'paused' : 'active';
  const d = db(env);
  const r = await d.prepare(`UPDATE clients SET status = ?, updated_at = ${NOW} WHERE name = ?`).bind(status, name).run();
  if (!r.meta?.changes) return fail(404, 'No such client.');
  await d.prepare('INSERT INTO client_events (client, action, by) VALUES (?, ?, ?)').bind(name, action === 'pause' ? 'paused' : 'resumed', email).run();
  console.log(`admin ${action} client=${name} by=${email}`);
  return Response.redirect(`${publicUrl(env, url)}/admin`, 303);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json(200, { ok: true, service: 'ita-auth' });
      if (request.method === 'GET' && url.pathname === '/authorize') return await authorize(env, url);
      if (request.method === 'GET' && url.pathname === '/callback') return await callback(env, url);
      if (request.method === 'POST' && url.pathname === '/token') return await token(env, request);
      if (request.method === 'POST' && url.pathname === '/register') return await register(env, request);
      if (url.pathname.startsWith('/ita/')) return await itaProxy(env, request, url);
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        const email = await accessEmail(env, request);
        if (!email) return fail(403, 'Sign in through Cloudflare Access with an admin email.');
        if (request.method === 'GET' && url.pathname === '/admin') return await adminPage(env, email);
        const m = url.pathname.match(/^\/admin\/clients\/([^/]+)\/(pause|resume)$/);
        if (request.method === 'POST' && m) return await setStatus(env, request, url, email, decodeURIComponent(m[1]), m[2]);
      }
      return fail(404, 'Not found.');
    } catch (err) {
      console.log(`config-error ${err instanceof Error ? err.message : String(err)}`);
      return fail(500, err instanceof Error ? err.message : 'Broker error.');
    }
  },
};
