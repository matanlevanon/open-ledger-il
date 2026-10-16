import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { actorFrom } from '../../core/audit';
import { requireRole } from '../../core/auth';
import { transaction } from '../../core/db';
import { DomainError, ForbiddenError } from '../../core/errors';
import type { ModuleDef } from '../../core/module';
import type { AppEnv, Env } from '../../env';
import { declareManualAuth } from '../access/route-guard';
import {
  INBOX_KEYS,
  allowedSenders,
  gmailConfirmation,
  hmacHex,
  inboxAudit,
  inboxAvailable,
  inboxEnabled,
  processInboundEmail,
  recentEvents,
  settingStatement,
  verifyGatewayRequest,
} from './inbox';
import type { Deps } from './service';

/** The 401 body for every failed gateway request. It never says which check failed. */
const REFUSED = { error: { code: 'unauthorized', message: 'A valid signature is required.' } };

/**
 * R35: POST /api/inbox, the email gateway's way in. Outside Cloudflare Access like /mcp
 * (src/modules/sending/public-paths.ts). The HMAC signature with INBOX_SECRET is the authorization.
 */
export function createInboxModule(resolveDeps: (env: Env) => Deps): ModuleDef {
  const r = new Hono<AppEnv>();
  r.post('/', declareManualAuth('HMAC signature with INBOX_SECRET, checked in verifyGatewayRequest'), async (c) => {
    if (!inboxAvailable(c.env)) return c.json({ error: { code: 'not_found', message: 'No such endpoint.' } }, 404);
    const raw = await c.req.arrayBuffer();
    if (!(await verifyGatewayRequest(c.env, c.req.raw.headers, raw))) return c.json(REFUSED, 401);
    const result = await processInboundEmail(c.env, resolveDeps(c.env), raw, c.req.header('X-Ledger-Envelope-From') ?? '');
    // The inbox switched off refuses the email for good, so the sender sees it bounce.
    if (result.outcome === 'off') return c.json({ error: { code: 'inbox_off', message: 'The inbox is off.' } }, 403);
    return c.json(result);
  });
  return { name: 'inbox', basePath: '/inbox', routes: r };
}

const SendersBody = z.object({ senders: z.array(z.string().trim().toLowerCase().email()).max(50) });
const EnabledBody = z.object({ enabled: z.boolean() });

async function inboxState(env: Env) {
  const get = async (key: string) => (await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>())?.value ?? null;
  const address = await get(INBOX_KEYS.address);
  return {
    configured: Boolean(address && env.INBOX_SECRET),
    address,
    enabled: await inboxEnabled(env.DB),
    senders: await allowedSenders(env),
    gmail: await gmailConfirmation(env.DB),
    events: await recentEvents(env.DB, 10),
    canRotate: Boolean((await get(INBOX_KEYS.gateway)) && (await get(INBOX_KEYS.id)) && env.INBOX_SECRET),
  };
}

/** R35: Settings > Expenses > Email inbox, under /api/expenses/settings/inbox. Owner only. */
export function registerInboxSettingsRoutes(app: Hono<AppEnv>, resolveDeps: (env: Env) => Deps): void {
  const owner = requireRole('owner');
  const notInDemo: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (!inboxAvailable(c.env)) throw new ForbiddenError();
    await next();
  };

  app.get('/settings/inbox', owner, notInDemo, async (c) => c.json(await inboxState(c.env)));

  app.put('/settings/inbox/senders', owner, notInDemo, async (c) => {
    const { senders } = SendersBody.parse(await c.req.json());
    const list = [...new Set(senders)];
    await transaction(c.env.DB, [settingStatement(c.env.DB, INBOX_KEYS.senders, JSON.stringify(list)), inboxAudit(c.env.DB, actorFrom(c), 'inbox.senders', { senders: list })]);
    return c.json({ senders: list });
  });

  app.put('/settings/inbox/enabled', owner, notInDemo, async (c) => {
    const { enabled } = EnabledBody.parse(await c.req.json());
    await transaction(c.env.DB, [settingStatement(c.env.DB, INBOX_KEYS.enabled, enabled ? '1' : '0'), inboxAudit(c.env.DB, actorFrom(c), 'inbox.enabled', { enabled })]);
    return c.json({ enabled });
  });

  // A new address from the gateway. The old one stops at once.
  app.post('/settings/inbox/rotate', owner, notInDemo, async (c) => {
    const get = async (key: string) => (await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>())?.value ?? null;
    const gateway = (await get(INBOX_KEYS.gateway))?.replace(/\/+$/, '');
    const inboxId = await get(INBOX_KEYS.id);
    const secret = c.env.INBOX_SECRET;
    if (!gateway || !inboxId || !secret) throw new DomainError('inbox_not_set_up', 'The email inbox is not set up. Run the installer again.', 409);
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ inboxId, timestamp });
    const fetchFn = resolveDeps(c.env).gatewayFetch ?? ((i, init) => fetch(i, init));
    let res: Response;
    try {
      res = await fetchFn(`${gateway}/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Inbox-Signature': await hmacHex(secret, `${timestamp}.${body}`) },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new DomainError('inbox_gateway_down', 'The email gateway did not answer. Try again in a minute.', 502);
    }
    const data = (await res.json().catch(() => ({}))) as { inboxId?: string; address?: string };
    if (!res.ok || !data.inboxId || !data.address) throw new DomainError('inbox_rotate_failed', `The email gateway refused (HTTP ${res.status}).`, 502);
    await transaction(c.env.DB, [
      settingStatement(c.env.DB, INBOX_KEYS.id, data.inboxId),
      settingStatement(c.env.DB, INBOX_KEYS.address, data.address),
      inboxAudit(c.env.DB, actorFrom(c), 'inbox.rotate', { address: data.address }),
    ]);
    return c.json(await inboxState(c.env));
  });
}
