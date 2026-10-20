import { Hono } from 'hono';
import { z } from 'zod';
import { actorFrom } from '../../core/audit';
import { requireRole } from '../../core/auth';
import { businessIdOf } from '../../core/business';
import { ValidationError } from '../../core/errors';
import type { ModuleDef } from '../../core/module';
import type { AppEnv } from '../../env';
import { DRIVE_DAILY_CRON } from '../expenses/drive-import';
import { SCOPES, createApiKey, listApiKeys, pruneApiTables, revokeApiKey } from './keys';

/**
 * R41: Settings > MCP and API, the API half. Owner only: the address, the Business ID, the keys,
 * Create key (shown once) and Revoke. The /v1 router itself is mounted in src/index.ts, outside
 * /api and Cloudflare Access. The daily cron prunes the rate and idempotency tables.
 */

export { apiRoutes, createApiRoutes } from './routes';
export type { ApiRoutesOptions } from './routes';

const CreateBody = z.object({
  name: z.string().trim().min(1, 'Name the key, for example Financy.').max(80),
  scope: z.enum(SCOPES).default('read'),
});

export function createApiSettingsModule(): ModuleDef {
  const r = new Hono<AppEnv>();
  r.use('*', requireRole('owner'));

  r.get('/', async (c) => {
    const base = (c.env.PUBLIC_APP_URL || new URL(c.req.url).origin).replace(/\/+$/, '');
    return c.json({ address: `${base}/v1`, businessId: businessIdOf(c), keys: await listApiKeys(c.env.DB, businessIdOf(c)) });
  });

  r.post('/', async (c) => {
    const body = CreateBody.parse(await c.req.json().catch(() => ({})));
    const made = await createApiKey(c.env.DB, actorFrom(c), body.name, body.scope);
    c.header('Cache-Control', 'no-store');
    return c.json(made, 201);
  });

  r.delete('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isSafeInteger(id) || id <= 0) throw new ValidationError('Expected a key id.');
    await revokeApiKey(c.env.DB, actorFrom(c), id);
    return c.json({ revoked: true });
  });

  return {
    name: 'api-settings',
    basePath: '/settings/api-keys',
    routes: r,
    crons: [DRIVE_DAILY_CRON],
    async scheduled(controller, env) {
      if (controller.cron === DRIVE_DAILY_CRON) await pruneApiTables(env.DB);
    },
  };
}

export const apiSettingsModule = createApiSettingsModule();
