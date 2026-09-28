import { type Context, Hono } from 'hono';
import { actorFrom } from '../../core/audit';
import { requireFeature, requireRole } from '../../core/auth';
import { NotFoundError, ValidationError } from '../../core/errors';
import type { ModuleDef } from '../../core/module';
import type { AppEnv } from '../../env';
import type { PaymentMethodRow } from './repo';
import { listPaymentMethods } from './repo';
import { paymentMethodInput, paymentMethodPatch, reorderInput } from './schemas';
import { createPaymentMethod, reorder, setActive, updatePaymentMethod } from './service';

/** `details` travels as a JSON string in the DB row; the API returns it parsed. */
function toApi(row: PaymentMethodRow) {
  return { ...row, details: JSON.parse(row.details) as Record<string, unknown> };
}

async function listApi(db: D1Database) {
  return (await listPaymentMethods(db)).map(toApi);
}

function num(c: Context<AppEnv>): number {
  const v = Number(c.req.param('id'));
  if (!Number.isSafeInteger(v) || v <= 0) throw new NotFoundError('Payment method', c.req.param('id'));
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
 * Routes under /api/payment-methods (R17 task 2). Reads need the `income_documents` feature (the
 * catalog feeds document editors); writes are owner only, same split as clients and settings.
 */
export function createPaymentMethodsModule(): ModuleDef {
  const r = new Hono<AppEnv>();

  r.get('/', requireFeature('income_documents'), async (c) => {
    const activeOnly = c.req.query('active') === '1';
    const rows = activeOnly ? await listPaymentMethods(c.env.DB, true) : await listPaymentMethods(c.env.DB);
    return c.json({ paymentMethods: rows.map(toApi) });
  });

  r.post('/', requireRole('owner'), async (c) => {
    const input = paymentMethodInput.parse(await body(c));
    await createPaymentMethod(c.env.DB, actorFrom(c), input);
    return c.json({ paymentMethods: await listApi(c.env.DB) }, 201);
  });

  r.patch('/:id', requireRole('owner'), async (c) => {
    const id = num(c);
    const patch = paymentMethodPatch.parse(await body(c));
    await updatePaymentMethod(c.env.DB, actorFrom(c), id, patch);
    return c.json({ paymentMethods: await listApi(c.env.DB) });
  });

  r.post('/:id/activate', requireRole('owner'), async (c) => {
    await setActive(c.env.DB, actorFrom(c), num(c), true);
    return c.json({ paymentMethods: await listApi(c.env.DB) });
  });

  r.post('/:id/deactivate', requireRole('owner'), async (c) => {
    await setActive(c.env.DB, actorFrom(c), num(c), false);
    return c.json({ paymentMethods: await listApi(c.env.DB) });
  });

  r.put('/reorder', requireRole('owner'), async (c) => {
    const { ids } = reorderInput.parse(await body(c));
    await reorder(c.env.DB, actorFrom(c), ids);
    return c.json({ paymentMethods: await listApi(c.env.DB) });
  });

  return { name: 'payment-methods', basePath: '/payment-methods', routes: r };
}

export const paymentMethodsModule = createPaymentMethodsModule();
