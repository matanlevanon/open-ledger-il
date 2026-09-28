import { Hono } from 'hono';
import { actorFrom, auditStatement } from '../../core/audit';
import {
  ACCOUNTANT_FEATURES,
  DEFAULT_ACCOUNTANT_FEATURES,
  requireRole,
  type AccountantFeature,
} from '../../core/auth';
import { all, first, stmt, todayIsrael, transaction } from '../../core/db';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors';
import type { AppEnv } from '../../env';
import { inviteAccountantSchema, updateAccountantSchema } from './schemas';

interface UserRow {
  id: number;
  email: string;
  name: string | null;
  role: 'owner' | 'accountant';
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
  role: 'owner' | 'accountant';
  active: boolean;
  accessEndsOn: string | null;
  features: Record<AccountantFeature, boolean> | null;
}

function featureMapFor(rows: FeatureRow[], userId: number): Record<AccountantFeature, boolean> {
  const enabled = new Map(rows.filter((r) => r.user_id === userId).map((r) => [r.feature, r.enabled === 1]));
  const out = {} as Record<AccountantFeature, boolean>;
  for (const f of ACCOUNTANT_FEATURES) out[f] = enabled.get(f) ?? DEFAULT_ACCOUNTANT_FEATURES[f];
  return out;
}

async function summarize(db: D1Database): Promise<UserSummary[]> {
  const users = await all<UserRow>(
    db,
    'SELECT id, email, name, role, active, access_ends_on FROM users ORDER BY role DESC, email',
  );
  const features = await all<FeatureRow>(db, 'SELECT user_id, feature, enabled FROM user_features');
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    active: u.active === 1,
    accessEndsOn: u.access_ends_on,
    features: u.role === 'accountant' ? featureMapFor(features, u.id) : null,
  }));
}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('The user id must be a positive whole number.');
  return id;
}

async function loadAccountant(db: D1Database, id: number): Promise<UserRow> {
  const row = await first<UserRow>(db, 'SELECT id, email, name, role, active, access_ends_on FROM users WHERE id = ?', id);
  if (!row) throw new NotFoundError('user', id);
  if (row.role !== 'accountant') throw new ValidationError('Only an accountant account can be changed here.');
  return row;
}

export const usersRoutes = new Hono<AppEnv>();

usersRoutes.get('/', requireRole('owner'), async (c) => {
  return c.json({ users: await summarize(c.env.DB) });
});

usersRoutes.post('/', requireRole('owner'), async (c) => {
  const body = inviteAccountantSchema.parse(await c.req.json());
  const db = c.env.DB;

  if (body.accessEndsOn <= todayIsrael()) {
    throw new ValidationError('The access end date must be in the future.');
  }
  if (await first(db, 'SELECT id FROM users WHERE email = ?', body.email)) {
    throw new ConflictError('user_exists', 'An account with this email already exists.');
  }

  const features: Record<AccountantFeature, boolean> = { ...DEFAULT_ACCOUNTANT_FEATURES, ...body.features };
  try {
    await transaction(db, [
      stmt(
        db,
        `INSERT INTO users (email, name, role, access_ends_on) VALUES (?, ?, 'accountant', ?)`,
        body.email,
        body.name ?? null,
        body.accessEndsOn,
      ),
      ...ACCOUNTANT_FEATURES.map((f) =>
        stmt(
          db,
          `INSERT INTO user_features (user_id, feature, enabled) SELECT id, ?, ? FROM users WHERE email = ?`,
          f,
          features[f],
          body.email,
        ),
      ),
      auditStatement(db, actorFrom(c), 'user.invite', 'user', body.email, {
        name: body.name ?? null,
        accessEndsOn: body.accessEndsOn,
        features,
      }),
    ]);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      throw new ConflictError('user_exists', 'An account with this email already exists.');
    }
    throw err;
  }

  const created = (await summarize(db)).find((u) => u.email === body.email);
  return c.json({ user: created }, 201);
});

usersRoutes.patch('/:id', requireRole('owner'), async (c) => {
  const id = parseId(c.req.param('id'));
  const body = updateAccountantSchema.parse(await c.req.json());
  const db = c.env.DB;
  const target = await loadAccountant(db, id);

  const statements: D1PreparedStatement[] = [];
  if (body.name !== undefined) {
    statements.push(
      stmt(db, `UPDATE users SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`, body.name, id),
    );
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
  statements.push(auditStatement(db, actorFrom(c), 'user.update', 'user', target.email, body));
  await transaction(db, statements);

  const updated = (await summarize(db)).find((u) => u.id === id);
  return c.json({ user: updated });
});

usersRoutes.delete('/:id', requireRole('owner'), async (c) => {
  const id = parseId(c.req.param('id'));
  const db = c.env.DB;
  const target = await loadAccountant(db, id);
  const features = await all<FeatureRow>(db, 'SELECT user_id, feature, enabled FROM user_features WHERE user_id = ?', id);

  await transaction(db, [
    auditStatement(db, actorFrom(c), 'user.revoke', 'user', target.email, {
      accessEndsOn: target.access_ends_on,
      features: featureMapFor(features, id),
    }),
    stmt(db, `DELETE FROM users WHERE id = ? AND role = 'accountant'`, id),
  ]);

  return c.body(null, 204);
});
