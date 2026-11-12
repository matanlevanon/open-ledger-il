import { Hono } from 'hono';
import { z } from 'zod';
import { actorFrom } from '../../core/audit';
import { type AuthUser, isLedgerAdmin, requireLedgerAdmin, requireRole } from '../../core/auth';
import { businessIdOf } from '../../core/business';
import { ForbiddenError } from '../../core/errors';
import type { ModuleDef } from '../../core/module';
import type { AppEnv } from '../../env';
import { isDemo } from '../demo/config';
import { activeToken, makeMcpToken, mcpEnabled, setMcpEnabled } from './tokens';

/**
 * R34: Settings > MCP under /api/settings/mcp. Owner only. The demo answers 403 on every route.
 * The plain token leaves the Worker once, in the answer to POST /token.
 */
export type McpTokenState =
  | { state: 'none' }
  | { state: 'installer' }
  | { state: 'ledger'; last4: string; createdAt: string; createdBy: string; lastUsedAt: string | null };

const EnabledBody = z.object({ enabled: z.boolean() });
const TokenBody = z.object({ scope: z.enum(['ledger', 'business']).optional() });

/**
 * R48: the scope Settings > MCP shows and makes tokens for. Single edition: the Ledger-wide token,
 * as before. Firm edition: a business owner sees and makes only their business's token. A Ledger
 * admin works on the Ledger-wide token, or the business's token when asked for it.
 */
function tokenScope(user: AuthUser, businessId: number, wanted?: 'ledger' | 'business'): number | null {
  if (user.edition !== 'firm') return null;
  if (isLedgerAdmin(user) && wanted !== 'business') return null;
  return businessId;
}

export function createMcpSettingsModule(): ModuleDef {
  const r = new Hono<AppEnv>();
  r.use('*', requireRole('owner'));
  r.use('*', async (c, next) => {
    if (isDemo(c.env)) throw new ForbiddenError();
    await next();
  });

  r.get('/', async (c) => {
    const base = (c.env.PUBLIC_APP_URL || new URL(c.req.url).origin).replace(/\/+$/, '');
    const wanted = c.req.query('scope') === 'business' ? 'business' : undefined;
    const scope = tokenScope(c.get('user'), businessIdOf(c), wanted);
    const row = await activeToken(c.env.DB, scope);
    const token: McpTokenState = row
      ? { state: 'ledger', last4: row.last4, createdAt: row.created_at, createdBy: row.created_by, lastUsedAt: row.last_used_at }
      : c.env.MCP_TOKEN && scope === null
        ? { state: 'installer' }
        : { state: 'none' };
    return c.json({
      address: `${base}/mcp`,
      enabled: await mcpEnabled(c.env.DB),
      token,
      // R48: which token this screen shows, and the header a business-bound client sends.
      scope: scope === null ? 'ledger' : 'business',
      businessId: scope,
      canToggle: isLedgerAdmin(c.get('user')),
    });
  });

  r.post('/token', async (c) => {
    const { scope: wanted } = TokenBody.parse(await c.req.json().catch(() => ({})));
    const made = await makeMcpToken(c.env.DB, actorFrom(c), tokenScope(c.get('user'), businessIdOf(c), wanted));
    c.header('Cache-Control', 'no-store');
    return c.json({ token: made.token, last4: made.last4 }, 201);
  });

  // R48: MCP on or off is one switch for the whole Ledger.
  r.post('/enabled', requireLedgerAdmin(), async (c) => {
    const { enabled } = EnabledBody.parse(await c.req.json().catch(() => ({})));
    await setMcpEnabled(c.env.DB, actorFrom(c), enabled);
    return c.json({ enabled });
  });

  return { name: 'mcp-settings', basePath: '/settings/mcp', routes: r };
}

export const mcpSettingsModule = createMcpSettingsModule();
