import { Hono } from 'hono';
import { z } from 'zod';
import { actorFrom } from '../../core/audit';
import { requireRole } from '../../core/auth';
import { businessIdOf } from '../../core/business';
import { ForbiddenError } from '../../core/errors';
import type { AppEnv } from '../../env';
import { isDemo } from '../demo/config';
import type { SyncCounts } from '../financy/connection';
import { type WiseDeps, disconnectWise, loadWise, saveWise, wiseView } from './connection';
import { WISE_DAILY_DAYS, WISE_FIRST_DAYS, syncWise, wiseErrorMessage } from './sync';

/**
 * R49: /api/wise, Settings > Expenses > Wise connection. Owner only, never in the demo. No answer
 * ever carries the token.
 */

const ConnectBody = z.object({
  token: z.string().trim().min(8, 'Paste the API token.').max(500),
  profileId: z.number().int().positive().optional(),
});

export function createWiseRoutes(resolveDeps: (env: AppEnv['Bindings']) => WiseDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const owner = requireRole('owner');
  const notInDemo = async (c: { env: AppEnv['Bindings'] }, next: () => Promise<void>) => {
    if (isDemo(c.env)) throw new ForbiddenError();
    await next();
  };
  const origin = (c: { env: AppEnv['Bindings']; req: { url: string } }) => c.env.PUBLIC_APP_URL || new URL(c.req.url).origin;
  const view = async (c: { env: AppEnv['Bindings']; req: { url: string } }, businessId: number) => wiseView(await loadWise(c.env.DB, businessId), origin(c));

  r.get('/', owner, notInDemo, async (c) => c.json({ connection: await view(c, businessIdOf(c)) }));

  // Connect, or replace the token. Wise is asked first, and a refusal saves nothing. Then the first
  // sync reads 90 days. A sync that fails leaves the connection saved, with the reason on it.
  r.put('/', owner, notInDemo, async (c) => {
    const body = ConnectBody.parse(await c.req.json().catch(() => ({})));
    const deps = resolveDeps(c.env);
    const actor = actorFrom(c);
    await saveWise(c.env, deps, body, origin(c), actor);
    let sync: SyncCounts | null = null;
    let syncError: string | null = null;
    try {
      sync = await syncWise(c.env, deps, businessIdOf(c), { days: WISE_FIRST_DAYS, actor });
    } catch (err) {
      syncError = wiseErrorMessage(err);
    }
    c.header('Cache-Control', 'no-store');
    return c.json({ connection: await view(c, businessIdOf(c)), sync, syncError });
  });

  r.post('/sync', owner, notInDemo, async (c) => {
    const counts = await syncWise(c.env, resolveDeps(c.env), businessIdOf(c), { days: WISE_DAILY_DAYS, actor: actorFrom(c) });
    return c.json({ connection: await view(c, businessIdOf(c)), sync: counts });
  });

  r.delete('/', owner, notInDemo, async (c) => {
    await disconnectWise(c.env, resolveDeps(c.env), actorFrom(c));
    return c.json({ connection: await view(c, businessIdOf(c)) });
  });

  return r;
}
