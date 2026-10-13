import { first, run } from '../../core/db';
import { SESSION_COOKIE, SESSION_HOURS } from './config';

/**
 * R26: the demo session. The cookie holds a random token. The database keeps only its SHA-256.
 * A session names a synthetic user (a visitor's sandbox owner, or the sample set's owner for the
 * admin). Core auth (src/core/auth.ts) signs that user in when DEMO_MODE=1.
 */

export interface DemoSession {
  userId: number;
  email: string;
  sandboxId: number | null;
  admin: boolean;
  adminEmail: string | null;
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

export async function createSession(
  db: D1Database,
  input: { userId: number; sandboxId: number | null; admin?: boolean; adminEmail?: string | null },
  now = new Date(),
): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = base64url(bytes);
  await run(
    db,
    'INSERT INTO demo_sessions (token_hash, sandbox_id, user_id, admin, admin_email, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    await sha256Hex(token),
    input.sandboxId,
    input.userId,
    input.admin ? 1 : 0,
    input.adminEmail ?? null,
    new Date(now.getTime() + SESSION_HOURS * 3600_000).toISOString(),
  );
  return token;
}

export async function sessionFromCookie(db: D1Database, cookieHeader: string | undefined | null, now = new Date()): Promise<DemoSession | null> {
  const token = sessionCookieValue(cookieHeader);
  if (!token) return null;
  const row = await first<{ user_id: number; sandbox_id: number | null; admin: number; admin_email: string | null; expires_at: string; email: string }>(
    db,
    `SELECT s.user_id, s.sandbox_id, s.admin, s.admin_email, s.expires_at, u.email
       FROM demo_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    await sha256Hex(token),
  );
  if (!row || row.expires_at <= now.toISOString()) return null;
  // A sandbox removed by the nightly reset ends its sessions.
  if (row.sandbox_id !== null && !(await first(db, 'SELECT 1 FROM demo_sandboxes WHERE id = ?', row.sandbox_id))) return null;
  return { userId: row.user_id, email: row.email, sandboxId: row.sandbox_id, admin: row.admin === 1, adminEmail: row.admin_email };
}
