import { type Context, Hono } from 'hono';
import { actorFrom } from '../../core/audit';
import { requireFeature, requireRole } from '../../core/auth';
import { NotFoundError, ValidationError } from '../../core/errors';
import type { ModuleDef } from '../../core/module';
import type { AppEnv } from '../../env';
import { listServices } from './repo';
import { reorderInput, serviceInput, servicePatch } from './schemas';
import { createService, reorder, setActive, updateService } from './service';

function num(c: Context<AppEnv>): number {
  const v = Number(c.req.param('id'));
  if (!Number.isSafeInteger(v) || v <= 0) throw new NotFoundError('Service', c.req.param('id'));
  return v;
}

async function body(c: Context<AppEnv>): Promise<unknown> {
  const text = await c.req.text();
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new ValidationError('The request body is not valid JSON.');
  }
}

/**
 * Routes under /api/services (R17 task 5). Reads need the `income_documents` feature (the
 * catalog feeds document editors); writes are owner only, same split as clients and settings.
 */
export function createServicesModule(): ModuleDef {
  const r = new Hono<AppEnv>();

  r.get('/', requireFeature('income_documents'), async (c) => {
    const activeOnly = c.req.query('active') === '1';
    return c.json({ services: activeOnly ? await listServices(c.env.DB, true) : await listServices(c.env.DB) });
  });

  r.post('/', requireRole('owner'), async (c) => {
    const input = serviceInput.parse(await body(c));
    await createService(c.env.DB, actorFrom(c), input);
    return c.json({ services: await listServices(c.env.DB) }, 201);
  });

  r.patch('/:id', requireRole('owner'), async (c) => {
    const id = num(c);
    const patch = servicePatch.parse(await body(c));
    await updateService(c.env.DB, actorFrom(c), id, patch);
    return c.json({ services: await listServices(c.env.DB) });
  });

  r.post('/:id/activate', requireRole('owner'), async (c) => {
    await setActive(c.env.DB, actorFrom(c), num(c), true);
    return c.json({ services: await listServices(c.env.DB) });
  });

  r.post('/:id/archive', requireRole('owner'), async (c) => {
    await setActive(c.env.DB, actorFrom(c), num(c), false);
    return c.json({ services: await listServices(c.env.DB) });
  });

  r.put('/reorder', requireRole('owner'), async (c) => {
    const { ids } = reorderInput.parse(await body(c));
    await reorder(c.env.DB, actorFrom(c), ids);
    return c.json({ services: await listServices(c.env.DB) });
  });

  return { name: 'services', basePath: '/services', routes: r };
}

export const servicesModule = createServicesModule();
