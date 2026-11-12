import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { actorFrom, auditStatement } from '../../core/audit';
import { ACCOUNTANT_FEATURES, DEFAULT_ACCOUNTANT_FEATURES, type AccountantFeature, type LedgerAdminMiddleware, requireLedgerAdmin } from '../../core/auth';
import { all, first, stmt, todayIsrael, transaction } from '../../core/db';
import { ledgerEdition } from '../../core/edition';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, mapDbError } from '../../core/errors';
import type { AppEnv } from '../../env';

/**
 * R48 task 1: Settings > Firm team. Firm edition, Ledger admins only. Firm staff hold one Ledger
 * grant that reaches every client business, present and future (ledger_grants). Admins own every
 * business (users.is_ledger_admin). A direct grant on one business wins over the Ledger grant.
 * Audited as ledger.grant, ledger.revoke, ledger.admin_add and ledger.admin_remove.
 */

const email = z.string().trim().toLowerCase().pipe(z.email());
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const featureSchema = z.record(z.string(), z.boolean()).optional();

const addSchema = z.object({
  email,
  name: z.string().trim().max(200).nullish(),
  role: z.enum(['admin', 'assistant', 'accountant']),
  features: featureSchema,
  endsAt: dateSchema.nullish(),
});

const updateSchema = z.object({
  role: z.enum(['assistant', 'accountant']).optional(),
  features: featureSchema,
  endsAt: dateSchema.nullish(),
});

export interface FirmTeamMember {
  id: number;
  email: string;
  name: string | null;
  role: 'admin' | 'assistant' | 'accountant';
  features: Record<AccountantFeature, boolean> | null;
  endsAt: string | null;
  active: boolean;
  /** The only active admin of the Ledger. The screen offers no Remove. */
  lastAdmin?: true;
}

function featureMap(raw: string | null): Record<AccountantFeature, boolean> {
  let parsed: Record<string, boolean> = {};
  try {
    parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    parsed = {};
  }
  const out = {} as Record<AccountantFeature, boolean>;
  for (const f of ACCOUNTANT_FEATURES) out[f] = parsed[f] ?? DEFAULT_ACCOUNTANT_FEATURES[f];
  return out;
}

function cleanFeatures(input: Record<string, boolean> | undefined): Record<AccountantFeature, boolean> {
  const out = { ...DEFAULT_ACCOUNTANT_FEATURES } as Record<AccountantFeature, boolean>;
  for (const [k, v] of Object.entries(input ?? {})) {
    if (!(ACCOUNTANT_FEATURES as string[]).includes(k)) throw new ValidationError(`Unknown feature "${k}".`);
    out[k as AccountantFeature] = v;
  }
  return out;
}

export async function listFirmTeam(db: D1Database): Promise<FirmTeamMember[]> {
  const admins = await all<{ id: number; email: string; name: string | null; active: number }>(
    db,
    'SELECT id, email, name, active FROM users WHERE is_ledger_admin = 1 ORDER BY email',
  );
  const staff = await all<{
    id: number;
    email: string;
    name: string | null;
    active: number;
    role: 'assistant' | 'accountant';
    features: string | null;
    ends_at: string | null;
  }>(
    db,
    `SELECT u.id, u.email, u.name, u.active, g.role, g.features, g.ends_at
       FROM ledger_grants g JOIN users u ON u.id = g.user_id
      WHERE u.is_ledger_admin = 0 ORDER BY u.email`,
  );
  const activeAdmins = admins.filter((a) => a.active === 1);
  return [
    ...admins.map((a) => ({
      id: a.id,
      email: a.email,
      name: a.name,
      role: 'admin' as const,
      features: null,
      endsAt: null,
      active: a.active === 1,
      ...(activeAdmins.length === 1 && activeAdmins[0]!.id === a.id ? { lastAdmin: true as const } : {}),
    })),
    ...staff.map((s) => ({
      id: s.id,
      email: s.email,
      name: s.name,
      role: s.role,
      features: s.role === 'accountant' ? featureMap(s.features) : null,
      endsAt: s.ends_at,
      active: s.active === 1,
    })),
  ];
}

/** True when this user is firm staff or an admin, so a business owner may not change the account. */
export async function isFirmTeam(db: D1Database, userId: number): Promise<boolean> {
  const row = await first<{ n: number }>(
    db,
    'SELECT COALESCE((SELECT is_ledger_admin FROM users WHERE id = ?), 0) + (SELECT COUNT(*) FROM ledger_grants WHERE user_id = ?) AS n',
    userId,
    userId,
  );
  return (row?.n ?? 0) > 0;
}

export const firmTeamRoutes = new Hono<AppEnv>();

/** Ledger admins in the firm edition. Declared for the route guard like requireLedgerAdmin. */
const ledgerAdmin = requireLedgerAdmin();
const firmAdmin: LedgerAdminMiddleware = Object.assign(
  (async (c, next) => {
    if (ledgerEdition(c.env) !== 'firm') throw new ForbiddenError('The firm team is part of the firm edition.');
    await ledgerAdmin(c, next);
  }) as MiddlewareHandler<AppEnv>,
  { roles: ledgerAdmin.roles, ledgerAdmin: true as const },
);

firmTeamRoutes.get('/', firmAdmin, async (c) => c.json({ team: await listFirmTeam(c.env.DB) }));

firmTeamRoutes.post('/', firmAdmin, async (c) => {
  const body = addSchema.parse(await c.req.json().catch(() => ({})));
  const db = c.env.DB;
  if (body.endsAt && body.endsAt <= todayIsrael()) throw new ValidationError('The end date must be in the future.');
  const existing = await first<{ id: number; is_ledger_admin: number }>(db, 'SELECT id, is_ledger_admin FROM users WHERE email = ?', body.email);
  if (existing && (existing.is_ledger_admin === 1 || (await first(db, 'SELECT 1 FROM ledger_grants WHERE user_id = ?', existing.id)))) {
    throw new ConflictError('user_exists', 'This person is already on the firm team.');
  }
  const actor = actorFrom(c);
  const statements: D1PreparedStatement[] = [];
  if (!existing) {
    statements.push(
      stmt(db, 'INSERT INTO users (email, name, role) VALUES (?, ?, ?)', body.email, body.name ?? null, body.role === 'accountant' ? 'accountant' : 'owner'),
    );
  } else {
    statements.push(stmt(db, "UPDATE users SET active = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", existing.id));
  }
  if (body.role === 'admin') {
    statements.push(stmt(db, 'UPDATE users SET is_ledger_admin = 1 WHERE email = ?', body.email));
    statements.push(auditStatement(db, actor, 'ledger.admin_add', 'user', body.email, {}));
  } else {
    const features = body.role === 'accountant' ? cleanFeatures(body.features) : null;
    statements.push(
      stmt(
        db,
        `INSERT INTO ledger_grants (user_id, role, features, granted_by, ends_at)
         SELECT id, ?, ?, ?, ? FROM users WHERE email = ?`,
        body.role,
        features ? JSON.stringify(features) : null,
        c.get('user').id,
        body.endsAt ?? null,
        body.email,
      ),
    );
    statements.push(auditStatement(db, actor, 'ledger.grant', 'user', body.email, { role: body.role, features, endsAt: body.endsAt ?? null }));
  }
  await transaction(db, statements);
  return c.json({ team: await listFirmTeam(db) }, 201);
});

function idOf(raw: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ValidationError('The user id must be a positive whole number.');
  return id;
}

firmTeamRoutes.patch('/:id', firmAdmin, async (c) => {
  const id = idOf(c.req.param('id'));
  const body = updateSchema.parse(await c.req.json().catch(() => ({})));
  const db = c.env.DB;
  const grant = await first<{ role: string; features: string | null; email: string; ends_at: string | null }>(
    db,
    'SELECT g.role, g.features, g.ends_at, u.email FROM ledger_grants g JOIN users u ON u.id = g.user_id WHERE g.user_id = ?',
    id,
  );
  if (!grant) throw new NotFoundError('Firm team member', id);
  const role = body.role ?? grant.role;
  const features = role === 'accountant' ? cleanFeatures({ ...featureMap(grant.features), ...(body.features ?? {}) }) : null;
  const endsAt = body.endsAt === undefined ? grant.ends_at : body.endsAt;
  await transaction(db, [
    stmt(
      db,
      'UPDATE ledger_grants SET role = ?, features = ?, ends_at = ?, granted_by = ? WHERE user_id = ?',
      role,
      features ? JSON.stringify(features) : null,
      endsAt,
      c.get('user').id,
      id,
    ),
    auditStatement(db, actorFrom(c), 'ledger.grant', 'user', grant.email, { role, features, endsAt }),
  ]);
  return c.json({ team: await listFirmTeam(db) });
});

firmTeamRoutes.delete('/:id', firmAdmin, async (c) => {
  const id = idOf(c.req.param('id'));
  const db = c.env.DB;
  const grant = await first<{ role: string; email: string }>(
    db,
    'SELECT g.role, u.email FROM ledger_grants g JOIN users u ON u.id = g.user_id WHERE g.user_id = ?',
    id,
  );
  if (!grant) throw new NotFoundError('Firm team member', id);
  await transaction(db, [
    auditStatement(db, actorFrom(c), 'ledger.revoke', 'user', grant.email, { role: grant.role }),
    stmt(db, 'DELETE FROM ledger_grants WHERE user_id = ?', id),
  ]);
  return c.body(null, 204);
});

firmTeamRoutes.post('/:id/admin', firmAdmin, async (c) => {
  const id = idOf(c.req.param('id'));
  const db = c.env.DB;
  const user = await first<{ email: string }>(db, 'SELECT email FROM users WHERE id = ?', id);
  if (!user) throw new NotFoundError('User', id);
  await transaction(db, [
    stmt(db, 'UPDATE users SET is_ledger_admin = 1, active = 1 WHERE id = ?', id),
    stmt(db, 'DELETE FROM ledger_grants WHERE user_id = ?', id),
    auditStatement(db, actorFrom(c), 'ledger.admin_add', 'user', user.email, {}),
  ]);
  return c.json({ team: await listFirmTeam(db) });
});

firmTeamRoutes.delete('/:id/admin', firmAdmin, async (c) => {
  const id = idOf(c.req.param('id'));
  const db = c.env.DB;
  const user = await first<{ email: string; is_ledger_admin: number }>(db, 'SELECT email, is_ledger_admin FROM users WHERE id = ?', id);
  if (!user || user.is_ledger_admin !== 1) throw new NotFoundError('Ledger admin', id);
  try {
    await transaction(db, [
      stmt(db, 'UPDATE users SET is_ledger_admin = 0 WHERE id = ?', id),
      auditStatement(db, actorFrom(c), 'ledger.admin_remove', 'user', user.email, {}),
    ]);
  } catch (err) {
    throw mapDbError(err);
  }
  return c.json({ team: await listFirmTeam(db) });
});
