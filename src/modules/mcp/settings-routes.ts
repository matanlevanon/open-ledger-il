import { Hono } from 'hono';
import { z } from 'zod';
import { actorFrom } from '../../core/audit';
import { requireRole } from '../../core/auth';
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

export function createMcpSettingsModule(): ModuleDef {
  const r = new Hono<AppEnv>();
  r.use('*', requireRole('owner'));
  r.use('*', async (c, next) => {
    if (isDemo(c.env)) throw new ForbiddenError();
    await next();
  });

  r.get('/', async (c) => {
    const base = (c.env.PUBLIC_APP_URL || new URL(c.req.url).origin).replace(/\/+$/, '');
    const row = await activeToken(c.env.DB);
    const token: McpTokenState = row
      ? { state: 'ledger', last4: row.last4, createdAt: row.created_at, createdBy: row.created_by, lastUsedAt: row.last_used_at }
      : c.env.MCP_TOKEN
        ? { state: 'installer' }
        : { state: 'none' };
    return c.json({ address: `${base}/mcp`, enabled: await mcpEnabled(c.env.DB), token });
  });

  r.post('/token', async (c) => {
    const made = await makeMcpToken(c.env.DB, actorFrom(c));
    c.header('Cache-Control', 'no-store');
    return c.json({ token: made.token, last4: made.last4 }, 201);
  });

  r.post('/enabled', async (c) => {
    const { enabled } = EnabledBody.parse(await c.req.json().catch(() => ({})));
    await setMcpEnabled(c.env.DB, actorFrom(c), enabled);
    return c.json({ enabled });
  });

  return { name: 'mcp-settings', basePath: '/settings/mcp', routes: r };
}

export const mcpSettingsModule = createMcpSettingsModule();
