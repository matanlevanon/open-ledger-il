import { first, run } from '../../core/db';
import { SESSION_COOKIE, SESSION_HOURS, SESSION_IDLE_MINUTES, SESSION_TOUCH_SECONDS } from './config';

/**
 * R26, R29: the demo session. The cookie holds a random token. The database keeps only its
 * SHA-256. A visitor session names a synthetic user linked to the shared sample businesses, and a
 * random session key that tags every row the visitor creates. It ends after 30 idle minutes. The
 * admin's session opens the sample set itself, has no key, and lasts 24 hours.
 */

export interface DemoSession {
  userId: number;
  email: string;
  /** Tags the visitor's own rows. Null for the admin's sample-set session. */
  sessionKey: string | null;
  admin: boolean;
  adminEmail: string | null;
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A new random cookie token. */
export function newSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function sessionCookieValue(header: string | undefined | null): string | null {
  const m = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([A-Za-z0-9_-]{20,})`).exec(header ?? '');
  return m?.[1] ?? null;
}

export function sessionCookie(token: string, maxAgeSeconds = SESSION_HOURS * 3600): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

const idleUntil = (now: Date) => new Date(now.getTime() + SESSION_IDLE_MINUTES * 60_000).toISOString();

export async function createSession(
  db: D1Database,
  input: { userId: number; admin?: boolean; adminEmail?: string | null; leadId?: number | null },
  now = new Date(),
): Promise<{ token: string; sessionKey: string | null }> {
  const token = newSessionToken();
  const sessionKey = input.admin ? null : crypto.randomUUID();
  await run(
    db,
    'INSERT INTO demo_sessions (token_hash, user_id, admin, admin_email, expires_at, session_key, lead_id, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    await sha256Hex(token),
    input.userId,
    input.admin ? 1 : 0,
    input.adminEmail ?? null,
    input.admin ? new Date(now.getTime() + SESSION_HOURS * 3600_000).toISOString() : idleUntil(now),
    sessionKey,
    input.leadId ?? null,
    now.toISOString(),
  );
  return { token, sessionKey };
}

/**
 * The session the cookie names, or null when it is unknown, expired or swept. A visitor's request
 * moves the 30-minute idle clock, at most once a minute.
 */
export async function sessionFromCookie(db: D1Database, cookieHeader: string | undefined | null, now = new Date()): Promise<DemoSession | null> {
  const token = sessionCookieValue(cookieHeader);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await first<{ user_id: number; session_key: string | null; admin: number; admin_email: string | null; expires_at: string; last_seen_at: string | null; email: string }>(
    db,
    `SELECT s.user_id, s.session_key, s.admin, s.admin_email, s.expires_at, s.last_seen_at, u.email
       FROM demo_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    hash,
  );
  if (!row || row.expires_at <= now.toISOString()) return null;
  // A session from before R29 has no key and is not the admin's: it belongs to a removed sandbox.
  if (row.admin !== 1 && !row.session_key) return null;
  if (row.admin !== 1 && (!row.last_seen_at || Date.parse(row.last_seen_at) < now.getTime() - SESSION_TOUCH_SECONDS * 1000)) {
    await run(db, 'UPDATE demo_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ? AND expires_at > ?', now.toISOString(), idleUntil(now), hash, now.toISOString());
  }
  return { userId: row.user_id, email: row.email, sessionKey: row.session_key, admin: row.admin === 1, adminEmail: row.admin_email };
}
