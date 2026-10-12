import { Hono } from 'hono';
import { actorFrom, auditStatement } from '../../core/audit';
import {
  ACCOUNTANT_FEATURES,
  DEFAULT_ACCOUNTANT_FEATURES,
  requireRole,
  type AccountantFeature,
  type Role,
} from '../../core/auth';
import { businessIdOf } from '../../core/business';
import { all, first, stmt, todayIsrael, transaction } from '../../core/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../core/errors';
import type { AppEnv } from '../../env';
import { addUserSchema, updateUserSchema } from './schemas';

/**
 * Settings > Users (R23 task 6, R24 Phase B). Access is granted per business: a person holds one
 * role in each business they may open, owner, assistant or accountant. Lists and changes act on
 * the current business. The last owner of a business is never removed or downgraded. Every grant,
 * change and removal is audited. Cloudflare Access is separate: the app cannot add an email
 * there, so each new email comes back with the one line the owner must act on (task 7).
 */

interface MemberRow {
  id: number;
  email: string;
  name: string | null;
  role: Role;
  active: number;
  access_ends_on: string | null;
}

interface FeatureRow {
  user_id: number;
  feature: string;
  enabled: number;
}

export interface UserSummary {
  id: number;
  email: string;
  name: string | null;
  role: Role;
  active: boolean;
  accessEndsOn: string | null;
  features: Record<AccountantFeature, boolean> | null;
  /** Every business this person may open, with the role there. */
  businesses: { id: number; role: Role }[];
}

/** Task 7: the step the owner takes in Cloudflare, since the app cannot add people to Access. */
export const ACCESS_NOTE =
  'Also add this email to your Cloudflare Access policy: Zero Trust > Access > Applications > the ledger app > Policies > Include > Emails.';

function featureMapFor(rows: FeatureRow[], userId: number): Record<AccountantFeature, boolean> {
  const enabled = new Map(rows.filter((r) => r.user_id === userId).map((r) => [r.feature, r.enabled === 1]));
  const out = {} as Record<AccountantFeature, boolean>;
  for (const f of ACCOUNTANT_FEATURES) out[f] = enabled.get(f) ?? DEFAULT_ACCOUNTANT_FEATURES[f];
  return out;
}

/** The people of one business, with their role there. */
async function summarize(db: D1Database, businessId: number): Promise<UserSummary[]> {
  const members = await all<MemberRow>(
    db,
    `SELECT u.id, u.email, u.name, ub.role, u.active, COALESCE(ub.ends_at, u.access_ends_on) AS access_ends_on
       FROM users u JOIN user_businesses ub ON ub.user_id = u.id AND ub.business_id = ?
      ORDER BY CASE ub.role WHEN 'owner' THEN 0 WHEN 'assistant' THEN 1 ELSE 2 END, u.email`,
    businessId,
  );
  const features = await all<FeatureRow>(db, 'SELECT user_id, feature, enabled FROM user_features');
  const grants = await all<{ user_id: number; business_id: number; role: Role }>(db, 'SELECT user_id, business_id, role FROM user_businesses ORDER BY business_id');
  return members.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    active: u.active === 1,
    accessEndsOn: u.access_ends_on,
    features: u.role === 'accountant' ? featureMapFor(features, u.id) : null,
    businesses: grants.filter((g) => g.user_id === u.id).map((g) => ({ id: g.business_id, role: g.role })),
  }));
}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('The user id must be a positive whole number.');
  return id;
}

async function loadMember(db: D1Database, id: number, businessId: number): Promise<MemberRow> {
  const row = await first<MemberRow>(
    db,
    `SELECT u.id, u.email, u.name, ub.role, u.active, u.access_ends_on
       FROM users u JOIN user_businesses ub ON ub.user_id = u.id AND ub.business_id = ? WHERE u.id = ?`,
    businessId,
    id,
  );
  if (!row) throw new NotFoundError('user', id);
  return row;
}

/** The last owner of a business is never removed or downgraded. */
async function assertNotLastOwner(db: D1Database, member: MemberRow, businessId: number): Promise<void> {
  if (member.role !== 'owner') return;
  const owners = await first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM user_businesses WHERE business_id = ? AND role = 'owner'", businessId);
  if ((owners?.n ?? 0) <= 1) throw new ValidationError('The last owner of a business stays. Add another owner first.');
}

export const usersRoutes = new Hono<AppEnv>();

usersRoutes.get('/', requireRole('owner'), async (c) => {
  return c.json({ users: await summarize(c.env.DB, businessIdOf(c)), accessNote: ACCESS_NOTE });
});

/**
 * Adds a person to one or more businesses with one role. Without a role, an accountant, as
 * before businesses existed. A person already in the Ledger is added to the businesses named.
 * The owner must own every business named.
 */
usersRoutes.post('/', requireRole('owner'), async (c) => {
  const body = addUserSchema.parse(await c.req.json());
  const db = c.env.DB;
  const user = c.get('user');
  const role: Role = body.role ?? 'accountant';
  const businessIds = body.businessIds ?? [businessIdOf(c)];
  for (const id of businessIds) {
    if (!user.businesses.some((b) => b.id === id && b.role === 'owner')) throw new ForbiddenError('You can only add people to businesses you own.');
  }
  if (role === 'accountant') {
    if (!body.accessEndsOn) throw new ValidationError('An accountant needs an access end date.');
    if (body.accessEndsOn <= todayIsrael()) throw new ValidationError('The access end date must be in the future.');
  }

  const existing = await first<{ id: number }>(db, 'SELECT id FROM users WHERE email = ?', body.email);
  if (existing) {
    const already = await first(
      db,
      `SELECT 1 FROM user_businesses WHERE user_id = ? AND business_id IN (${businessIds.map(() => '?').join(',')})`,
      existing.id,
      ...businessIds,
    );
    if (already) throw new ConflictError('user_exists', 'An account with this email already exists.');
  }

  const features: Record<AccountantFeature, boolean> = { ...DEFAULT_ACCOUNTANT_FEATURES, ...body.features };
  const endsAt = role === 'accountant' ? body.accessEndsOn! : null;
  try {
    await transaction(db, [
      ...(existing
        ? []
        : [
            // users.role is kept for history and only says accountant or not. user_businesses holds the real role.
            stmt(
              db,
              'INSERT INTO users (email, name, role, access_ends_on) VALUES (?, ?, ?, ?)',
              body.email,
              body.name ?? null,
              role === 'accountant' ? 'accountant' : 'owner',
              endsAt,
            ),
          ]),
      ...businessIds.map((businessId) =>
        stmt(
          db,
          `INSERT INTO user_businesses (user_id, business_id, role, granted_by, ends_at)
           SELECT id, ?, ?, ?, ? FROM users WHERE email = ?
           ON CONFLICT (user_id, business_id) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by, ends_at = excluded.ends_at`,
          businessId,
          role,
          user.id,
          endsAt,
          body.email,
        ),
      ),
      ...(role === 'accountant'
        ? ACCOUNTANT_FEATURES.map((f) =>
            stmt(
              db,
              `INSERT INTO user_features (user_id, feature, enabled) SELECT id, ?, ? FROM users WHERE email = ?
               ON CONFLICT (user_id, feature) DO UPDATE SET enabled = excluded.enabled`,
              f,
              features[f],
              body.email,
            ),
          )
        : []),
      auditStatement(db, actorFrom(c), 'user.invite', 'user', body.email, {
        name: body.name ?? null,
        role,
        businessIds,
        accessEndsOn: endsAt,
        ...(role === 'accountant' ? { features } : {}),
      }),
    ]);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      throw new ConflictError('user_exists', 'An account with this email already exists.');
    }
    throw err;
  }

  const created = (await summarize(db, businessIds[0]!)).find((u) => u.email === body.email);
  return c.json({ user: created, accessNote: ACCESS_NOTE }, 201);
});

usersRoutes.patch('/:id', requireRole('owner'), async (c) => {
  const id = parseId(c.req.param('id'));
  const body = updateUserSchema.parse(await c.req.json());
  const db = c.env.DB;
  const businessId = businessIdOf(c);
  const target = await loadMember(db, id, businessId);

  const accountantFields = body.name !== undefined || body.accessEndsOn !== undefined || body.features !== undefined;
  if (body.role === undefined && target.role !== 'accountant') throw new ValidationError('Only an accountant account can be changed here.');
  if (accountantFields && target.role !== 'accountant' && body.role !== 'accountant') {
    throw new ValidationError('Only an accountant has an end date and feature switches.');
  }

  const statements: D1PreparedStatement[] = [];
  if (body.role !== undefined && body.role !== target.role) {
    if (target.role === 'owner') await assertNotLastOwner(db, target, businessId);
    if (body.role === 'accountant' && !body.accessEndsOn && !target.access_ends_on) {
      throw new ValidationError('An accountant needs an access end date.');
    }
    statements.push(stmt(db, 'UPDATE user_businesses SET role = ?, granted_by = ? WHERE user_id = ? AND business_id = ?', body.role, c.get('user').id, id, businessId));
  }
  if (body.name !== undefined) {
    statements.push(stmt(db, `UPDATE users SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`, body.name, id));
  }
  if (body.accessEndsOn !== undefined) {
    const reactivate = body.accessEndsOn > todayIsrael();
    statements.push(
      stmt(
        db,
        `UPDATE users SET access_ends_on = ?, active = CASE WHEN ? = 1 THEN 1 ELSE active END,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
        body.accessEndsOn,
        reactivate,
        id,
      ),
      stmt(db, 'UPDATE user_businesses SET ends_at = ? WHERE user_id = ? AND business_id = ?', body.accessEndsOn, id, businessId),
    );
  }
  if (body.features) {
    for (const [feature, enabled] of Object.entries(body.features)) {
      statements.push(
        stmt(
          db,
          `INSERT INTO user_features (user_id, feature, enabled) VALUES (?, ?, ?)
           ON CONFLICT(user_id, feature) DO UPDATE SET enabled = excluded.enabled, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
          id,
          feature,
          enabled,
        ),
      );
    }
  }
  statements.push(auditStatement(db, actorFrom(c), body.role !== undefined ? 'user.role_change' : 'user.update', 'user', target.email, body));
  await transaction(db, statements);

  const updated = (await summarize(db, businessId)).find((u) => u.id === id);
  return c.json({ user: updated });
});

/**
 * Removes a person from the current business. A person left with no business at all loses the
 * account: an accountant row is deleted as before, anyone with history in the books is turned off.
 */
usersRoutes.delete('/:id', requireRole('owner'), async (c) => {
  const id = parseId(c.req.param('id'));
  const db = c.env.DB;
  const businessId = businessIdOf(c);
  const target = await loadMember(db, id, businessId);
  if (target.role === 'owner') await assertNotLastOwner(db, target, businessId);
  const features = await all<FeatureRow>(db, 'SELECT user_id, feature, enabled FROM user_features WHERE user_id = ?', id);
  const others = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM user_businesses WHERE user_id = ? AND business_id != ?', id, businessId);
  const last = (others?.n ?? 0) === 0;

  await transaction(db, [
    auditStatement(db, actorFrom(c), 'user.revoke', 'user', target.email, {
      role: target.role,
      businessId,
      accessEndsOn: target.access_ends_on,
      ...(target.role === 'accountant' ? { features: featureMapFor(features, id) } : {}),
    }),
    stmt(db, 'DELETE FROM user_businesses WHERE user_id = ? AND business_id = ?', id, businessId),
    ...(last && target.role === 'accountant'
      ? [stmt(db, 'DELETE FROM user_features WHERE user_id = ?', id), stmt(db, `DELETE FROM users WHERE id = ? AND role = 'accountant'`, id)]
      : last
        ? [stmt(db, "UPDATE users SET active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", id)]
        : []),
  ]);

  return c.body(null, 204);
});
