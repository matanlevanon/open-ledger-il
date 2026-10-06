/**
 * Cloudflare Access service auth, verified rather than assumed.
 *
 * The signature, algorithm, issuer, audience and time checks follow
 * Cloudflare's guide to validating Access JWTs. Who is allowed: one Access
 * service token, by its Client ID, because the caller is a Worker, not a
 * browser.
 *
 * The tunnel is not a perimeter. Anything that reaches the origin port reaches
 * this process, so a request without a verified assertion is refused here
 * even though Access should already have refused it.
 */

import { createPublicKey, createVerify } from 'node:crypto';

const HEADER = 'cf-access-jwt-assertion';
const COOKIE = 'CF_Authorization';

export function extractToken(headers = {}) {
  const direct = headers[HEADER];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const cookie = headers.cookie;
  if (typeof cookie === 'string') {
    for (const part of cookie.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      if (part.slice(0, eq).trim() !== COOKIE) continue;
      const v = part.slice(eq + 1).trim();
      if (v) return v;
    }
  }
  return null;
}

function b64urlToBuf(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function jsonSegment(s) {
  try {
    return JSON.parse(b64urlToBuf(s).toString('utf8'));
  } catch {
    return null;
  }
}

const deny = (status, reason) => ({ ok: false, status, reason });

/**
 * A certs fetcher with a cache. Access rotates keys, so an unknown kid is a
 * reason to refetch once, not a reason to fail. Refetches are rate limited so
 * a stream of junk tokens cannot turn into a stream of outbound requests.
 */
export function makeCertsFetcher({ certsUrl, fetchImpl = fetch, ttlMs = 60 * 60 * 1000, minRefetchMs = 60 * 1000, now = Date.now }) {
  let cached = null;
  let fetchedAt = 0;
  let lastForce = -Infinity;

  return async function getCerts({ force = false } = {}) {
    const t = now();
    const fresh = cached && t - fetchedAt < ttlMs;
    if (fresh && !force) return cached;
    // A rotation deserves one refetch. A thousand junk kids deserve one too.
    if (force && cached && t - lastForce < minRefetchMs) return cached;
    if (force) lastForce = t;

    const res = await fetchImpl(certsUrl);
    if (!res.ok) {
      if (cached) return cached;
      throw new Error(`Access certs fetch failed: ${res.status}`);
    }
    const body = await res.json();
    const keys = Array.isArray(body?.keys) ? body.keys : [];
    if (!keys.length) {
      if (cached) return cached;
      throw new Error('Access certs response carried no keys');
    }
    cached = keys;
    fetchedAt = t;
    return cached;
  };
}

function verifySignature(jwk, signingInput, sigB64) {
  let key;
  try {
    key = createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    return false;
  }
  try {
    return createVerify('RSA-SHA256').update(signingInput).verify(key, b64urlToBuf(sigB64));
  } catch {
    return false;
  }
}

/**
 * Returns {ok:true, clientId, payload} or {ok:false, status, reason}.
 * `reason` is for the log. The body sent back stays generic.
 */
export async function verifyServiceToken(token, opts) {
  const { issuer, aud, allowedClientIds, getCerts, now = () => Math.floor(Date.now() / 1000), skewSec = 60 } = opts;

  if (!token) return deny(401, 'no Access assertion on the request');

  const parts = String(token).split('.');
  if (parts.length !== 3) return deny(401, 'assertion is not a three part JWT');

  const header = jsonSegment(parts[0]);
  if (!header) return deny(401, 'unreadable JWT header');
  if (header.alg !== 'RS256') return deny(401, `refused alg ${JSON.stringify(header.alg)}, RS256 only`);
  if (typeof header.kid !== 'string' || !header.kid) return deny(401, 'JWT header carries no kid');

  let keys;
  try {
    keys = await getCerts();
  } catch (err) {
    return deny(401, `could not read Access public keys: ${err.message}`);
  }
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    try {
      keys = await getCerts({ force: true });
    } catch (err) {
      return deny(401, `could not refresh Access public keys: ${err.message}`);
    }
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return deny(401, `no Access public key for kid ${header.kid}`);

  if (!verifySignature(jwk, `${parts[0]}.${parts[1]}`, parts[2])) {
    return deny(401, 'signature does not verify against the Access key');
  }

  const payload = jsonSegment(parts[1]);
  if (!payload) return deny(401, 'unreadable JWT payload');

  if (payload.iss !== issuer) return deny(401, `issuer ${JSON.stringify(payload.iss)} is not ${issuer}`);

  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return deny(401, 'token was issued for a different Access application');

  const t = now();
  if (typeof payload.exp !== 'number') return deny(401, 'token carries no exp');
  if (payload.exp + skewSec <= t) return deny(401, 'token expired');
  if (typeof payload.nbf === 'number' && payload.nbf - skewSec > t) return deny(401, 'token not valid yet');
  if (typeof payload.iat === 'number' && payload.iat - skewSec > t) return deny(401, 'token issued in the future');

  // A service token assertion names the token's Client ID in common_name and
  // carries no email. Anything else is a person's session, which this relay
  // never serves.
  const clientId = String(payload.common_name || '').trim();
  if (!clientId) return deny(403, `token carries no common_name (claims: ${Object.keys(payload).join(', ')})`);
  if (!allowedClientIds.includes(clientId)) return deny(403, `service token ${clientId} is not on the allowlist`);

  return { ok: true, clientId, payload };
}
