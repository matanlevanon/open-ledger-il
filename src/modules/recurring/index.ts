import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { type AuditActor, actorFrom } from '../../core/audit';
import { type AuthUser, FEATURES, requireFeature } from '../../core/auth';
import { first } from '../../core/db';
import { NotFoundError, ValidationError } from '../../core/errors';
import type { ModuleDef } from '../../core/module';
import type { AppEnv, Env } from '../../env';
import { type DocumentsModuleOptions, buildDocumentsServices } from '../documents';
import type { Ctx } from '../documents/service';
import { ResendMailer, sendDocumentEmail } from '../sending';
import { FREQUENCIES, type SendFn, approveRun, createSchedule, listRuns, listSchedules, runDue, skipRun, updateSchedule } from './service';

/** Daily, with the payment reminders: a copy made in the morning is in the client's inbox with them. */
export const RECURRING_CRON = '0 7 * * *';

export interface RecurringModuleOptions {
  documentsOptions?: DocumentsModuleOptions;
  /** Emails a final document. Default: the sending module's email with the real mailer. Tests pass a fake. */
  send?: (env: Env, baseUrl: string) => SendFn;
}

function defaultSend(env: Env, baseUrl: string): SendFn {
  return async (documentId, actor) => {
    if (!env.MAIL_API_KEY) throw new Error('MAIL_API_KEY is not set. Outgoing email is unavailable.');
    await sendDocumentEmail({ db: env.DB, files: env.FILES, env, mailer: new ResendMailer(env.MAIL_API_KEY), baseUrl }, { documentId, actor });
  };
}

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const createInput = z.object({
  templateDocumentId: z.number().int().positive(),
  name: z.string().max(200).nullable().optional(),
  frequency: z.enum(FREQUENCIES),
  startDate: dateString,
  endDate: dateString.nullable().optional(),
  mode: z.enum(['approve', 'auto']).default('approve'),
  sendEmail: z.boolean().default(true),
});
const patchInput = z.object({
  name: z.string().max(200).nullable().optional(),
  frequency: z.enum(FREQUENCIES).optional(),
  nextRunDate: dateString.optional(),
  endDate: dateString.nullable().optional(),
  mode: z.enum(['approve', 'auto']).optional(),
  sendEmail: z.boolean().optional(),
  active: z.boolean().optional(),
});

async function body(c: Context<AppEnv>): Promise<unknown> {
  const text = await c.req.text();
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new ValidationError('The request body is not valid JSON.');
  }
}

function idParam(c: Context<AppEnv>): number {
  const v = Number(c.req.param('id'));
  if (!Number.isSafeInteger(v) || v <= 0) throw new NotFoundError('Recurring', c.req.param('id'));
  return v;
}

/** The documents Ctx for the cron: acts as the first active owner, audited as the recurring job. */
async function cronCtx(env: Env, options: RecurringModuleOptions): Promise<Ctx | null> {
  const owner = await first<{ id: number; email: string; name: string | null }>(
    env.DB,
    "SELECT id, email, name FROM users WHERE role = 'owner' AND active = 1 ORDER BY id LIMIT 1",
  );
  if (!owner) return null;
  const user: AuthUser = { id: owner.id, email: owner.email, name: owner.name, role: 'owner', features: [...FEATURES], theme: null, locale: null };
  const actor: AuditActor = { userId: owner.id, email: owner.email, role: 'system:recurring', ip: null, userAgent: null };
  return { db: env.DB, actor, user, services: buildDocumentsServices(options.documentsOptions ?? {}, env) };
}

/** Recurring documents: /api/recurring, plus the daily run. Owner only (issue_documents). */
export function createRecurringModule(options: RecurringModuleOptions = {}): ModuleDef {
  const sendFor = options.send ?? defaultSend;
  const r = new Hono<AppEnv>();
  const ctx = (c: Context<AppEnv>): Ctx => ({
    db: c.env.DB,
    actor: actorFrom(c),
    user: c.get('user'),
    services: buildDocumentsServices(options.documentsOptions ?? {}, c.env),
  });
  const send = (c: Context<AppEnv>) => sendFor(c.env, c.env.PUBLIC_APP_URL || new URL(c.req.url).origin);
  const state = async (c: Context<AppEnv>) => ({ schedules: await listSchedules(c.env.DB), runs: await listRuns(c.env.DB) });

  r.get('/', requireFeature('issue_documents'), async (c) => c.json(await state(c)));

  r.post('/', requireFeature('issue_documents'), async (c) => {
    await createSchedule(ctx(c), createInput.parse(await body(c)));
    return c.json(await state(c), 201);
  });

  r.patch('/:id', requireFeature('issue_documents'), async (c) => {
    await updateSchedule(ctx(c), idParam(c), patchInput.parse(await body(c)));
    return c.json(await state(c));
  });

  /** Runs every schedule that is due today, now, instead of waiting for the morning run. */
  r.post('/run-due', requireFeature('issue_documents'), async (c) => {
    const result = await runDue(ctx(c), send(c));
    return c.json({ ...result, ...(await state(c)) });
  });

  r.post('/runs/:id/approve', requireFeature('issue_documents'), async (c) => {
    await approveRun(ctx(c), idParam(c), send(c));
    return c.json(await state(c));
  });

  r.post('/runs/:id/skip', requireFeature('issue_documents'), async (c) => {
    await skipRun(ctx(c), idParam(c));
    return c.json(await state(c));
  });

  return {
    name: 'recurring',
    basePath: '/recurring',
    routes: r,
    crons: [RECURRING_CRON],
    async scheduled(controller, env) {
      if (controller.cron !== RECURRING_CRON) return;
      const c = await cronCtx(env, options);
      if (!c) return;
      await runDue(c, sendFor(env, env.PUBLIC_APP_URL ?? ''));
    },
  };
}

export { nextRunDate, runDue, skipMissedRuns } from './service';
