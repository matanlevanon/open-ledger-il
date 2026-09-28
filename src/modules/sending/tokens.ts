import { ConfigError, UnauthorizedError } from '../../core/errors';
import type { Env } from '../../env';

/**
 * Signed, expiring links handed to a client, not a signed-in user: the consent request link and
 * the WhatsApp PDF share link. Same shape as `access/downloads.ts`'s signed download token
 * (HMAC-SHA256 over a base64url JSON payload), but under its own secret (`SEND_LINK_KEY`) since
 * these links are redeemed by the public routes in `routes.ts`, which sit outside the
 * `authenticate()` gate that protects everything else under `/api` (src/index.ts).
 */
export type SendTokenPayload =
  | { kind: 'consent'; clientId: number; exp: number }
  | { kind: 'share'; documentId: number; variant: 'client'; exp: number };

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

async function hmacKey(env: Pick<Env, 'SEND_LINK_KEY'>): Promise<CryptoKey> {
  const secret = env.SEND_LINK_KEY;
  if (!secret) throw new ConfigError('SEND_LINK_KEY is not set. Consent and share links are unavailable.');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function signSendToken(env: Pick<Env, 'SEND_LINK_KEY'>, payload: SendTokenPayload): Promise<string> {
  const body = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(env);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}

export async function verifySendToken(env: Pick<Env, 'SEND_LINK_KEY'>, token: string): Promise<SendTokenPayload> {
  const [body, signature] = token.split('.');
  if (!body || !signature) throw new UnauthorizedError('This link is not valid.');
  const key = await hmacKey(env);
  const valid = await crypto.subtle.verify('HMAC', key, fromBase64url(signature), new TextEncoder().encode(body));
  if (!valid) throw new UnauthorizedError('This link is not valid.');
  let payload: SendTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as SendTokenPayload;
  } catch {
    throw new UnauthorizedError('This link is not valid.');
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedError('This link has expired.');
  }
  return payload;
}

const DAY_SECONDS = 24 * 60 * 60;

export const CONSENT_LINK_TTL_SECONDS = 14 * DAY_SECONDS;
export const SHARE_LINK_TTL_SECONDS = 30 * DAY_SECONDS;

export function expiresAt(ttlSeconds: number, now = Date.now()): number {
  return Math.floor(now / 1000) + ttlSeconds;
}
