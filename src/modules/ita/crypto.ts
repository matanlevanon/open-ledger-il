import { ConfigError } from '../../core/errors';

/**
 * AES-GCM for ITA tokens at rest. The key is the ITA_TOKEN_KEY secret: 32 random bytes, base64.
 * Stored form: `v1.<iv base64>.<ciphertext base64>`. The environment name is the additional
 * data, so a sandbox token never decrypts as a production token (CLAUDE.md rule 7).
 */

const VERSION = 'v1';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(value: string): Uint8Array {
  const s = atob(value);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

export function importTokenKey(secret: string | undefined): Promise<CryptoKey> {
  const value = (secret ?? '').trim();
  if (!value) throw new ConfigError('Set the ITA_TOKEN_KEY secret (32 random bytes, base64).');
  let key = keyCache.get(value);
  if (!key) {
    let raw: Uint8Array;
    try {
      raw = fromBase64(value);
    } catch {
      throw new ConfigError('ITA_TOKEN_KEY must be base64.');
    }
    if (raw.length !== 32) throw new ConfigError('ITA_TOKEN_KEY must hold 32 bytes.');
    key = crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    keyCache.set(value, key);
  }
  return key;
}

export async function encryptToken(key: CryptoKey, plain: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plain);
  const aad = new TextEncoder().encode(context);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, data));
  return `${VERSION}.${toBase64(iv)}.${toBase64(ct)}`;
}

export async function decryptToken(key: CryptoKey, stored: string, context: string): Promise<string> {
  const [version, ivB64, ctB64] = stored.split('.');
  if (version !== VERSION || !ivB64 || !ctB64) throw new Error('Unknown token format.');
  const aad = new TextEncoder().encode(context);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivB64), additionalData: aad },
    key,
    fromBase64(ctB64),
  );
  return new TextDecoder().decode(plain);
}

/** A random URL-safe string for OAuth state and ids. */
export function randomToken(bytes = 24): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
