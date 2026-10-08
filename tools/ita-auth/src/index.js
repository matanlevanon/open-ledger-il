/**
 * ita-auth: an ITA login broker for Open Ledger IL installs that share one ITA API app.
 *
 * The app's client secret lives only here, as a Worker secret. Each Ledger install is a client
 * of this broker: it sends its users to /authorize for the ITA sign-in, and it calls /token to
 * trade the one-time code for tokens and to renew them. Invoice calls never pass here. Each
 * Ledger sends those straight to the ITA with its own access token.
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
 *   GET  /health
 *
 * Secrets and variables (see README.md)
 *   PUBLIC_URL                      optional, this Worker's own address. Default: the request's own.
 *   STATE_SECRET                    32 random bytes, base64. Signs the login state.
 *   BROKER_CLIENTS                  JSON list of Ledger installs allowed to use the broker
 *   ITA_CLIENT_ID_PRODUCTION, ITA_CLIENT_SECRET_PRODUCTION   (and _SANDBOX, optional)
 *   ITA_RELAY_URL, ITA_RELAY_CLIENT_ID, ITA_RELAY_CLIENT_SECRET   optional Israeli relay
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
const SCOPE = 'scope';
const STATE_TTL_MS = 15 * 60_000;
const RELAY_HOSTS = { 'openapi.taxes.gov.il': 'openapi', 'ita-api.taxes.gov.il': 'ita-api' };

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const fail = (status, message) => json(status, { broker_error: message });

/** This Worker's own address. PUBLIC_URL wins over the address the request came in on. */
function publicUrl(env, requestUrl) {
  return ((env.PUBLIC_URL ?? '').trim() || new URL(requestUrl).origin).replace(/\/+$/, '');
}

/** The Ledger installs allowed to use the broker: [{ name, origin, key_sha256 }]. */
function clients(env) {
  let list;
  try {
    list = JSON.parse(env.BROKER_CLIENTS ?? '[]');
  } catch {
    throw new Error('BROKER_CLIENTS is not valid JSON.');
  }
  if (!Array.isArray(list)) throw new Error('BROKER_CLIENTS must be a JSON list.');
  return list.filter((c) => c && typeof c.name === 'string' && typeof c.origin === 'string' && typeof c.key_sha256 === 'string');
}

function findClient(env, name) {
  return clients(env).find((c) => c.name === name) ?? null;
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
  const client = findClient(env, url.searchParams.get('client') ?? '');
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
  const client = findClient(env, payload.c);
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
  const client = findClient(env, name);
  if (!client || !key || !sameText(await sha256Hex(key), client.key_sha256.toLowerCase())) return fail(401, 'Unknown client or wrong key.');

  const form = new URLSearchParams(await request.text());
  const environment = form.get('environment') ?? '';
  const creds = credentials(env, environment);
  if (!creds) return fail(400, 'Unknown environment, or no ITA app set up for it.');

  const grant = form.get('grant_type') ?? '';
  let body;
  if (grant === 'authorization_code' && form.get('code')) {
    body = { grant_type: grant, code: form.get('code'), redirect_uri: `${publicUrl(env, request.url)}/callback`, scope: SCOPE };
  } else if (grant === 'refresh_token' && form.get('refresh_token')) {
    // The ITA developer guide sends the client credentials in the refresh body too.
    body = { grant_type: grant, refresh_token: form.get('refresh_token'), scope: SCOPE, client_id: creds.id, client_secret: creds.secret };
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
  console.log(`token client=${client.name} env=${environment} grant=${grant} ${res.status} ${Date.now() - started}ms`);
  return new Response(text, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json(200, { ok: true, service: 'ita-auth' });
      if (request.method === 'GET' && url.pathname === '/authorize') return await authorize(env, url);
      if (request.method === 'GET' && url.pathname === '/callback') return await callback(env, url);
      if (request.method === 'POST' && url.pathname === '/token') return await token(env, request);
      return fail(404, 'Not found.');
    } catch (err) {
      console.log(`config-error ${err instanceof Error ? err.message : String(err)}`);
      return fail(500, err instanceof Error ? err.message : 'Broker error.');
    }
  },
};
