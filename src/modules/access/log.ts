import { Hono } from 'hono';
import { requireRole } from '../../core/auth';
import { all, type SqlValue } from '../../core/db';
import type { AppEnv } from '../../env';
import { accessLogQuerySchema } from './schemas';

interface AuditLogRow {
  id: number;
  at: string;
  user_id: number | null;
  user_email: string | null;
  role: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: string | null;
  ip: string | null;
  user_agent: string | null;
}

export const logRoutes = new Hono<AppEnv>();

logRoutes.get('/', requireRole('owner'), async (c) => {
  const query = accessLogQuerySchema.parse(c.req.query());
  const conditions: string[] = [];
  const params: SqlValue[] = [];

  if (query.before !== undefined) {
    conditions.push('id < ?');
    params.push(query.before);
  }
  if (query.userEmail) {
    conditions.push('user_email = ?');
    params.push(query.userEmail);
  }
  if (query.action) {
    conditions.push('action = ?');
    params.push(query.action);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await all<AuditLogRow>(
    c.env.DB,
    `SELECT id, at, user_id, user_email, role, action, entity, entity_id, details, ip, user_agent
     FROM audit_log ${where} ORDER BY id DESC LIMIT ?`,
    ...params,
    query.limit,
  );

  return c.json({
    entries: rows.map((r) => ({
      id: r.id,
      at: r.at,
      userEmail: r.user_email,
      role: r.role,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      details: r.details ? JSON.parse(r.details) : null,
      ip: r.ip,
    })),
    nextBefore: rows.length === query.limit ? rows[rows.length - 1]!.id : null,
  });
});
