import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { stmt } from './db';
import { mapDbError } from './errors';

/** Who did it. Cron jobs and migrations use SYSTEM_ACTOR. */
export interface AuditActor {
  userId: number | null;
  email: string | null;
  role: string | null;
  ip: string | null;
  userAgent: string | null;
  /** R24: the business the action belongs to. Absent means business 1. */
  businessId?: number;
}

export const SYSTEM_ACTOR: AuditActor = { userId: null, email: 'system', role: 'system', ip: null, userAgent: null };

/** R24: the business an actor works on. Absent means business 1. */
export const actorBiz = (actor: AuditActor): number => actor.businessId ?? 1;

/** R24: the system actor for a cron job working on one business. */
export function systemActorFor(businessId: number): AuditActor {
  return { ...SYSTEM_ACTOR, businessId };
}

const SECRET_KEY = /secret|token|password|passwd|private|signing_key|api_key|apikey|tax.?id|authorization|cookie/i;

/** Drops values under secret-looking keys so audit details never hold a secret (CLAUDE.md rule 5). */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

export function actorFrom(c: Context<AppEnv>): AuditActor {
  const user = c.get('user') as AppEnv['Variables']['user'] | undefined;
  return {
    userId: user?.id ?? null,
    email: user?.email ?? null,
    role: user?.role ?? null,
    ip: c.req.header('CF-Connecting-IP') ?? null,
    userAgent: c.req.header('User-Agent')?.slice(0, 300) ?? null,
    businessId: user?.businessId ?? 1,
  };
}

/** The audit insert as a statement, for use inside a transaction batch. */
export function auditStatement(
  db: D1Database,
  actor: AuditActor,
  action: string,
  entity: string | null,
  entityId: string | number | null,
  details?: unknown,
): D1PreparedStatement {
  return stmt(
    db,
    `INSERT INTO audit_log (user_id, user_email, role, action, entity, entity_id, details, ip, user_agent, business_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    actor.userId,
    actor.email,
    actor.role,
    action,
    entity,
    entityId === null ? null : String(entityId),
    details === undefined ? null : JSON.stringify(redact(details)),
    actor.ip,
    actor.userAgent,
    actor.businessId ?? 1,
  );
}

/** Writes one audit row for the current request's user. */
export async function audit(
  c: Context<AppEnv>,
  action: string,
  entity: string | null,
  entityId: string | number | null,
  details?: unknown,
): Promise<void> {
  await auditAs(c.env.DB, actorFrom(c), action, entity, entityId, details);
}

export async function auditAs(
  db: D1Database,
  actor: AuditActor,
  action: string,
  entity: string | null,
  entityId: string | number | null,
  details?: unknown,
): Promise<void> {
  try {
    await auditStatement(db, actor, action, entity, entityId, details).run();
  } catch (err) {
    throw mapDbError(err);
  }
}
