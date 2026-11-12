import { Hono } from 'hono';
import { first, nowIso } from '../../core/db';
import { isMovedOut } from '../../core/business';
import type { AppEnv } from '../../env';
import { isDemo } from '../demo/config';
import { WISE_DEPOSIT_EVENT, WISE_EVENT } from './client';
import type { WiseDeps, WiseRow } from './connection';
import { WISE_EVENT_DAYS, syncWise } from './sync';

/**
 * R49: the address Wise calls when money moves on a balance: POST /v1/hooks/wise/<hook id>. It
 * sits under /v1, which Cloudflare Access already lets through, so a Ledger needs no new Access
 * application. No API key: the caller is known by two things together, the unguessable hook id
 * and Wise's RSA signature over the exact body (docs.wise.com/guides/developer/webhooks/event-handling).
 *
 * The event carries an amount and a currency and no payer. So money in only triggers a sync of
 * the last week, which reads the payer and the reference from the statement and matches the
 * deposit. The answer goes out at once, as Wise wants one within 5 seconds.
 */

/** Wise's production key for webhook signatures, as published in its developer guide. */
export const WISE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvO8vXV+JksBzZAY6GhSO
XdoTCfhXaaiZ+qAbtaDBiu2AGkGVpmEygFmWP4Li9m5+Ni85BhVvZOodM9epgW3F
bA5Q1SexvAF1PPjX4JpMstak/QhAgl1qMSqEevL8cmUeTgcMuVWCJmlge9h7B1CS
D4rtlimGZozG39rUBDg6Qt2K+P4wBfLblL0k4C4YUdLnpGYEDIth+i8XsRpFlogx
CAFyH9+knYsDbR43UJ9shtc42Ybd40Afihj8KnYKXzchyQ42aC8aZ/h5hyZ28yVy
Oj3Vos0VdBIs/gAyJ/4yyQFCXYte64I7ssrlbGRaco4nKF3HmaNhxwyKyJafz19e
HwIDAQAB
-----END PUBLIC KEY-----`;

function fromBase64(text: string): Uint8Array | null {
  try {
    const bin = atob(text.replace(/\s+/g, ''));
    return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/** True when `signature` (Base64) is Wise's RSA-SHA256 signature of `body`. Never throws. */
export async function verifyWiseSignature(body: ArrayBuffer, signature: string, publicKeyPem: string = WISE_PUBLIC_KEY): Promise<boolean> {
  const sig = fromBase64(signature);
  const der = fromBase64(publicKeyPem.replace(/-----[A-Z ]+-----/g, ''));
  if (!sig || sig.length === 0 || !der) return false;
  try {
    const key = await crypto.subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, body);
  } catch {
    return false;
  }
}

interface BalanceEvent {
  event_type?: string;
  data?: { resource?: { profile_id?: number | string }; transaction_type?: string };
}

export function createWiseHookRoutes(resolveDeps: (env: AppEnv['Bindings']) => WiseDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.post('/:hookId', async (c) => {
    // The demo has no Wise connection. It answers as the rest of /v1 does there.
    if (isDemo(c.env)) return c.json({ error: { code: 'demo_read_only', message: 'The demo API reads only.' } }, 403);
    const deps = resolveDeps(c.env);
    const body = await c.req.arrayBuffer();
    // The signature first: an unsigned caller learns nothing, not even whether the hook id exists.
    if (!(await verifyWiseSignature(body, c.req.header('X-Signature-SHA256') ?? '', deps.publicKeyPem))) {
      return c.json({ error: { code: 'bad_signature', message: 'The signature does not match.' } }, 401);
    }
    const row = await first<WiseRow>(c.env.DB, "SELECT * FROM wise_connection WHERE hook_id = ? AND status <> 'disconnected'", c.req.param('hookId'));
    if (!row) return c.json({ error: { code: 'not_found', message: 'No such endpoint.' } }, 404);
    await c.env.DB.prepare('UPDATE wise_connection SET last_event_at = ? WHERE business_id = ?').bind(nowIso(), row.business_id).run();

    // The test event Wise sends when a webhook is made.
    if ((c.req.header('X-Test-Notification') ?? '').toLowerCase() === 'true') return c.json({ ok: true, test: true });

    let event: BalanceEvent | null = null;
    try {
      event = JSON.parse(new TextDecoder().decode(body)) as BalanceEvent;
    } catch {
      event = null;
    }
    const moneyIn =
      (event?.event_type === WISE_EVENT || event?.event_type === WISE_DEPOSIT_EVENT) &&
      String(event.data?.resource?.profile_id ?? '') === String(row.profile_id) &&
      (event.data?.transaction_type ?? '').toLowerCase() === 'credit';
    // Money out waits for the daily sync. Another profile's event, or another event type, is acknowledged and dropped.
    if (!moneyIn || (await isMovedOut(c.env.DB, row.business_id).catch(() => false))) return c.json({ ok: true, synced: false });

    const work = syncWise(c.env, deps, row.business_id, { days: WISE_EVENT_DAYS }).catch(() => {
      // The failure is on the connection row (status error, last_error). Wise still gets its 200.
    });
    let background: { waitUntil(p: Promise<unknown>): void } | null = null;
    try {
      background = c.executionCtx;
    } catch {
      background = null;
    }
    if (background) background.waitUntil(work);
    else await work;
    return c.json({ ok: true, synced: true });
  });

  return r;
}
