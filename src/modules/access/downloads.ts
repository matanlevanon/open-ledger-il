import type { Feature } from '../../core/auth';
import { ConfigError, UnauthorizedError } from '../../core/errors';
import type { Env } from '../../env';

/**
 * Signed, time-limited R2 download links (docs/accountant-access.md "Controls": 10-minute expiry).
 * Any module can call `signDownloadUrl` to hand its own screen a link; the redemption route lives
 * here (`GET /access/downloads/:token`) since every download shares the same signature check and
 * R2 read. The signing module still owns deciding whether the requester may have that link at all.
 */
export interface DownloadPayload {
  key: string;
  feature: Feature;
  exp: number;
  /** R17 task 3: 'inline' opens the PDF in the tab, same as the draft preview; default stays 'attachment'. */
  disposition?: 'inline' | 'attachment';
  /** Download filename override, e.g. "<type>-<number>-<client>.pdf" (task 3). Default: the R2 key's last segment. */
  filename?: string;
}

const DEFAULT_TTL_SECONDS = 600;

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

async function hmacKey(env: Env): Promise<CryptoKey> {
  const secret = env.DOWNLOAD_SIGN_KEY;
  if (!secret) throw new ConfigError('DOWNLOAD_SIGN_KEY is not set. Signed downloads are unavailable.');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** Signs a link for `key`, redeemable only by a user who still holds `feature` when they open it. */
export async function signDownloadUrl(
  env: Env,
  key: string,
  feature: Feature,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  options: { disposition?: 'inline' | 'attachment'; filename?: string } = {},
): Promise<{ path: string; expiresAt: string }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload: DownloadPayload = { key, feature, exp, disposition: options.disposition, filename: options.filename };
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const cryptoKey = await hmacKey(env);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(body));
  const token = `${body}.${base64url(new Uint8Array(signature))}`;
  return { path: `/access/downloads/${token}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Verifies signature and expiry. Throws UnauthorizedError otherwise. Feature is re-checked by the caller. */
export async function verifyDownloadToken(env: Env, token: string): Promise<DownloadPayload> {
  const [body, signature] = token.split('.');
  if (!body || !signature) throw new UnauthorizedError('This download link is not valid.');
  const cryptoKey = await hmacKey(env);
  const valid = await crypto.subtle.verify('HMAC', cryptoKey, fromBase64url(signature), new TextEncoder().encode(body));
  if (!valid) throw new UnauthorizedError('This download link is not valid.');
  let payload: DownloadPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as DownloadPayload;
  } catch {
    throw new UnauthorizedError('This download link is not valid.');
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedError('This download link has expired.');
  }
  return payload;
}
