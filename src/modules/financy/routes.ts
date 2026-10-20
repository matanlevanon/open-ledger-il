import { Hono } from 'hono';
import { z } from 'zod';
import { actorFrom } from '../../core/audit';
import { requireFeatureOrAssistant, requireRole } from '../../core/auth';
import { businessIdOf } from '../../core/business';
import { ForbiddenError, ValidationError } from '../../core/errors';
import type { AppEnv } from '../../env';
import { isDemo } from '../demo/config';
import { MATCH_STATUSES, addAsExpense, assertConnected, ignoreTransaction, listBankAccounts, listBankTransactions } from './activity';
import { availableAccounts, pickAccounts } from './accounts';
import { type FinancyDeps, connectionView, deleteBankData, disconnect, loadConnection, saveConnection } from './connection';
import { DEFAULT_SYNC_DAYS, syncFinancy } from './sync';

/**
 * R40: /api/financy. The connection (owner only, never in the demo) and Bank activity (owner and
 * assistant act, the accountant reads). No answer ever carries the client secret.
 */

const ConnectBody = z.object({
  clientId: z.string().trim().min(1, 'Paste the Client ID.').max(200),
  clientSecret: z.string().trim().min(4, 'Paste the Client Secret.').max(500),
  userId: z.string().trim().min(1, 'Paste the User ID.').max(200),
});

const PickBody = z.object({
  accountIds: z.array(z.string().min(1).max(200)).max(100),
  confirm: z.boolean().optional(),
});

const ActivityQuery = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM').optional(),
  account: z.string().max(200).optional(),
  direction: z.enum(['in', 'out']).optional(),
  status: z.enum(MATCH_STATUSES).optional(),
});

function idParam(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Expected a positive integer id.');
  return id;
}

export function createFinancyRoutes(resolveDeps: (env: AppEnv['Bindings']) => FinancyDeps): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const owner = requireRole('owner');
  const notInDemo = async (c: { env: AppEnv['Bindings'] }, next: () => Promise<void>) => {
    if (isDemo(c.env)) throw new ForbiddenError();
    await next();
  };
  const view = async (db: D1Database, businessId: number) => connectionView(await loadConnection(db, businessId));

  r.get('/', owner, notInDemo, async (c) => c.json({ connection: await view(c.env.DB, businessIdOf(c)) }));

  // Connect, or replace the details. Financy is asked first. A refusal saves nothing. Nothing is
  // pulled until the owner picks the business accounts (task 3b), so the answer lists them.
  r.put('/', owner, notInDemo, async (c) => {
    const body = ConnectBody.parse(await c.req.json().catch(() => ({})));
    const deps = resolveDeps(c.env);
    await saveConnection(c.env, deps, body, actorFrom(c));
    c.header('Cache-Control', 'no-store');
    return c.json({ connection: await view(c.env.DB, businessIdOf(c)), accounts: await availableAccounts(c.env, deps, businessIdOf(c)) });
  });

  // Task 3b: the CHECKING and CARD accounts Financy holds, read live, with the picked ones marked.
  r.get('/available-accounts', owner, notInDemo, async (c) => c.json({ accounts: await availableAccounts(c.env, resolveDeps(c.env), businessIdOf(c)) }));

  // Task 3b: save the picks, then sync them. Unticking an account with stored rows needs `confirm`.
  r.put('/picked-accounts', owner, notInDemo, async (c) => {
    const body = PickBody.parse(await c.req.json().catch(() => ({})));
    const result = await pickAccounts(c.env, resolveDeps(c.env), body.accountIds, body.confirm === true, actorFrom(c));
    return c.json({ connection: await view(c.env.DB, businessIdOf(c)), ...result });
  });

  r.post('/sync', owner, notInDemo, async (c) => {
    const actor = actorFrom(c);
    const counts = await syncFinancy(c.env, resolveDeps(c.env), businessIdOf(c), { days: DEFAULT_SYNC_DAYS, actor });
    return c.json({ connection: await view(c.env.DB, businessIdOf(c)), sync: counts });
  });

  r.delete('/', owner, notInDemo, async (c) => {
    await disconnect(c.env.DB, actorFrom(c));
    return c.json({ connection: await view(c.env.DB, businessIdOf(c)) });
  });

  r.delete('/data', owner, notInDemo, async (c) => c.json({ deleted: await deleteBankData(c.env.DB, actorFrom(c)) }));

  // Bank activity.
  r.get('/accounts', requireFeatureOrAssistant('expenses'), async (c) => {
    await assertConnected(c.env.DB, businessIdOf(c));
    return c.json({ accounts: await listBankAccounts(c.env.DB, businessIdOf(c)) });
  });

  r.get('/transactions', requireFeatureOrAssistant('expenses'), async (c) => {
    const q = ActivityQuery.parse(c.req.query());
    const businessId = businessIdOf(c);
    await assertConnected(c.env.DB, businessId);
    const role = c.get('user').role;
    return c.json({
      transactions: await listBankTransactions(c.env.DB, businessId, { month: q.month, accountId: q.account, direction: q.direction, status: q.status }),
      accounts: await listBankAccounts(c.env.DB, businessId),
      canEdit: role === 'owner' || role === 'assistant',
    });
  });

  r.post('/transactions/:id/add-expense', requireRole('owner', 'assistant'), async (c) =>
    c.json(await addAsExpense(c.env, idParam(c.req.param('id')), actorFrom(c)), 201),
  );

  r.post('/transactions/:id/ignore', requireRole('owner', 'assistant'), async (c) =>
    c.json({ transaction: await ignoreTransaction(c.env.DB, idParam(c.req.param('id')), actorFrom(c)) }),
  );

  return r;
}
