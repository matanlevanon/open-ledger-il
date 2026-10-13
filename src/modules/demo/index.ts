import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { requireRole } from '../../core/auth';
import { first, nowIso, run } from '../../core/db';
import { UnauthorizedError } from '../../core/errors';
import type { ModuleDef } from '../../core/module';
import type { AppEnv, Env } from '../../env';
import { declareManualAuth } from '../access/route-guard';
import { CEILING_ALERT_CRON } from '../ceiling/cron';
import type { DocumentsModuleOptions } from '../documents';
import { type Notifier, slackNotifier } from '../ita/notify';
import { verifySendToken } from '../sending/tokens';
import { demoTexts, isDemo } from './config';
import { confirmConsent, forwardLeadEvents, queueLeadEvent, recordConsent, sendConfirmation, sendReopenCode, unsubscribeLead, upsertLead } from './leads';
import { gateMailer, latestOutbox } from './outbox';
import type { Mailer } from '../sending/mailer';
import { codePageHtml, gatePageHtml, type Lang, messagePageHtml } from './pages';
import { openSandbox, sandboxToday } from './sandbox';
import { createSession, sessionCookie, sessionFromCookie, sha256Hex } from './session';

export { isDemo, demoMisconfigured, demoEnv } from './config';
export { demoGuard } from './guard';
export { ensureMasters, copySandbox } from './sample';

export interface DemoOptions {
  documentsOptions?: DocumentsModuleOptions;
  /** Turnstile, the lead webhook and Slack. Injected in tests. */
  fetchFn?: typeof fetch;
  now?: () => Date;
  /** The gate's own email (confirmation, codes). Default: Resend with MAIL_API_KEY and MAIL_FROM. */
  mailerFor?: (env: Env) => Mailer | null;
}

const enterInput = z.object({
  name: z.string().trim().min(1, 'Add your name.').max(200),
  email: z.string().trim().toLowerCase().email('Use a valid email.').max(200),
  consent: z.string().optional(),
  lang: z.enum(['en', 'he']).default('en'),
  'cf-turnstile-response': z.string().max(4096).optional(),
});

const CODE_TTL_MS = 10 * 60_000;

/** Every demo route answers 404 unless DEMO_MODE=1. Declared for the route guard (src/modules/access/route-guard.ts). */
const demoOnly = Object.assign(
  async (c: Context<AppEnv>, next: () => Promise<void>) => {
    if (!isDemo(c.env)) return c.json({ error: { code: 'not_found', message: 'No such endpoint.' } }, 404);
    await next();
  },
  { manualAuth: 'demo mode only: 404 unless DEMO_MODE=1, then each route checks its own session or token' },
);

function ipOf(c: Context<AppEnv>) {
  return c.req.header('CF-Connecting-IP') ?? null;
}

async function formOf(c: Context<AppEnv>): Promise<Record<string, string>> {
  const type = c.req.header('content-type') ?? '';
  if (type.includes('application/json')) return ((await c.req.json().catch(() => ({}))) as Record<string, string>) ?? {};
  const body = await c.req.parseBody();
  return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, typeof v === 'string' ? v : '']));
}

function baseUrl(c: Context<AppEnv>): string {
  return c.env.PUBLIC_APP_URL || new URL(c.req.url).origin;
}

/** Cloudflare Turnstile, verified server-side. Without a secret configured the check is skipped. */
export async function verifyTurnstile(env: Env, token: string | undefined, ip: string | null, fetchFn: typeof fetch): Promise<boolean> {
  const secret = (env.TURNSTILE_SECRET ?? '').trim();
  if (!secret) return true;
  if (!token) return false;
  const form = new FormData();
  form.set('secret', secret);
  form.set('response', token);
  if (ip) form.set('remoteip', ip);
  try {
    const res = await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const body = (await res.json()) as { success?: boolean };
    return body.success === true;
  } catch {
    return false;
  }
}

function redirectWithSession(token: string): Response {
  return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': sessionCookie(token), 'Cache-Control': 'no-store' } });
}

function sixDigits(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0]! % 1_000_000).padStart(6, '0');
}

/**
 * R26: /api/demo. The gate and its links, opened before any session exists. src/index.ts lets
 * these through without sign-in, only with DEMO_MODE=1.
 */
export function createDemoModule(options: DemoOptions = {}): ModuleDef {
  const r = new Hono<AppEnv>();
  const manual = declareManualAuth('demo gate: public, Turnstile and a rate of one sandbox per lead per day');
  const fetchFn = options.fetchFn ?? ((i: RequestInfo | URL, init?: RequestInit) => fetch(i, init));
  const notifier = (env: Env): Notifier => slackNotifier(env.SLACK_WEBHOOK_URL, fetchFn);
  const now = () => (options.now ? options.now() : new Date());

  r.use('*', demoOnly);

  r.post('/enter', manual, async (c) => {
    const raw = await formOf(c);
    const lang: Lang = raw.lang === 'he' ? 'he' : 'en';
    const parsed = enterInput.safeParse(raw);
    if (!parsed.success) return c.html(gatePageHtml(c.env, lang, { error: parsed.error.issues[0]?.message ?? 'Check the form.', name: raw.name, email: raw.email }), 400);
    const input = parsed.data;
    if (!(await verifyTurnstile(c.env, input['cf-turnstile-response'], ipOf(c), fetchFn))) {
      return c.html(gatePageHtml(c.env, lang, { error: lang === 'he' ? 'הבדיקה האוטומטית נכשלה. נסו שוב.' : 'The robot check failed. Try again.', name: input.name, email: input.email }), 400);
    }
    const lead = await upsertLead(c.env.DB, { name: input.name, email: input.email, ip: ipOf(c), userAgent: c.req.header('User-Agent') ?? null });
    const { consent, changed } = await recordConsent(c.env, lead, input.consent === 'yes', lang, ipOf(c));
    if (lead.visits === 1) await queueLeadEvent(c.env.DB, lead, 'lead', consent, c.env);
    else if (changed) await queueLeadEvent(c.env.DB, lead, 'consent', consent, c.env);
    const mailer = (options.mailerFor ?? gateMailer)(c.env);
    if (changed && consent.consent === 1 && mailer) {
      try {
        await sendConfirmation(c.env, mailer, baseUrl(c), lead, consent);
      } catch (err) {
        console.warn('demo_confirmation_not_sent', err instanceof Error ? err.message : 'unknown');
      }
    }
    await forwardLeadEvents(c.env, fetchFn, 5);

    // The same email on the same day reopens the same sandbox: from this browser at once, from
    // another browser after an email code. Without email, another browser gets a new copy.
    const existing = await sandboxToday(c.env.DB, lead.id, now());
    if (existing) {
      const session = await sessionFromCookie(c.env.DB, c.req.header('Cookie'), now());
      if (session && session.sandboxId === existing.id) return new Response(null, { status: 303, headers: { Location: '/' } });
      if (mailer) {
        const code = sixDigits();
        await run(c.env.DB, 'INSERT INTO demo_codes (lead_id, code_hash, expires_at) VALUES (?, ?, ?)', lead.id, await sha256Hex(`${lead.id}:${code}`), new Date(now().getTime() + CODE_TTL_MS).toISOString());
        await sendReopenCode(c.env, mailer, baseUrl(c), lead, code);
        return c.html(codePageHtml(lang, lead.email));
      }
    }
    const sandbox = await openSandbox(c.env, { documentsOptions: options.documentsOptions, notifier: notifier(c.env), now: options.now }, lead.id);
    return redirectWithSession(await createSession(c.env.DB, { userId: sandbox.user_id, sandboxId: sandbox.id }, now()));
  });

  r.post('/verify', manual, async (c) => {
    const raw = await formOf(c);
    const lang: Lang = raw.lang === 'he' ? 'he' : 'en';
    const email = String(raw.email ?? '').trim().toLowerCase();
    const lead = await first<{ id: number }>(c.env.DB, 'SELECT id FROM demo_leads WHERE email = ?', email);
    const sandbox = lead ? await sandboxToday(c.env.DB, lead.id, now()) : null;
    const code = await first<{ id: number; code_hash: string; expires_at: string; attempts: number }>(
      c.env.DB,
      'SELECT id, code_hash, expires_at, attempts FROM demo_codes WHERE lead_id = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1',
      lead?.id ?? -1,
    );
    const wrong = (msg: string) => c.html(codePageHtml(lang, email, msg), 400);
    if (!lead || !sandbox || !code) return wrong(lang === 'he' ? 'בקשו קוד חדש.' : 'Ask for a new code.');
    if (code.attempts >= 5 || code.expires_at <= now().toISOString()) return wrong(lang === 'he' ? 'הקוד פג. התחילו מחדש.' : 'The code expired. Start over.');
    if ((await sha256Hex(`${lead.id}:${String(raw.code ?? '').trim()}`)) !== code.code_hash) {
      await run(c.env.DB, 'UPDATE demo_codes SET attempts = attempts + 1 WHERE id = ?', code.id);
      return wrong(lang === 'he' ? 'הקוד שגוי.' : 'The code is not right.');
    }
    await run(c.env.DB, 'UPDATE demo_codes SET used_at = ? WHERE id = ?', nowIso(), code.id);
    return redirectWithSession(await createSession(c.env.DB, { userId: sandbox.user_id, sandboxId: sandbox.id }, now()));
  });

  r.get('/confirm/:token', manual, async (c) => {
    const lang: Lang = c.req.query('lang') === 'he' ? 'he' : 'en';
    try {
      const payload = await verifySendToken(c.env, c.req.param('token'));
      if (payload.kind !== 'demo_confirm') throw new UnauthorizedError('This link is not valid.');
      await confirmConsent(c.env, payload.consentId);
      await forwardLeadEvents(c.env, fetchFn, 5);
      return c.html(messagePageHtml(lang, lang === 'he' ? 'תודה' : 'Thank you', lang === 'he' ? 'אישרתם קבלת עדכונים.' : `You will get updates from ${demoTexts(c.env).sender}.`));
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) throw err;
      return c.html(messagePageHtml(lang, lang === 'he' ? 'הקישור אינו זמין' : 'Link unavailable', err.message), 410);
    }
  });

  r.get('/unsubscribe/:token', manual, async (c) => {
    const lang: Lang = c.req.query('lang') === 'he' ? 'he' : 'en';
    try {
      const payload = await verifySendToken(c.env, c.req.param('token'));
      if (payload.kind !== 'demo_unsubscribe') throw new UnauthorizedError('This link is not valid.');
      await unsubscribeLead(c.env, payload.leadId);
      await forwardLeadEvents(c.env, fetchFn, 5);
      return c.html(messagePageHtml(lang, lang === 'he' ? 'הוסרתם' : 'Unsubscribed', lang === 'he' ? 'לא יישלחו אליכם עוד עדכונים.' : 'You will get no more updates.'));
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) throw err;
      return c.html(messagePageHtml(lang, lang === 'he' ? 'הקישור אינו זמין' : 'Link unavailable', err.message), 410);
    }
  });

  return {
    name: 'demo',
    basePath: '/demo',
    routes: r,
    crons: [CEILING_ALERT_CRON],
    async scheduled(controller, env) {
      if (controller.cron !== CEILING_ALERT_CRON || !isDemo(env)) return;
      await forwardLeadEvents(env, fetchFn, 200);
    },
  };
}

/**
 * R26: /api/demo-app. For a signed-in demo visitor: the banner facts and the email previews.
 * Outside demo mode every route answers 404.
 */
export function createDemoAppModule(): ModuleDef {
  const r = new Hono<AppEnv>();
  r.use('*', demoOnly);
  r.get('/status', requireRole('owner', 'assistant', 'accountant'), (c) => {
    const texts = demoTexts(c.env);
    const demo = c.get('demo');
    return c.json({ demo: true, admin: demo?.admin ?? false, ctaUrl: texts.ctaUrl, product: texts.product, resetsAt: '03:00' });
  });
  r.get('/outbox', requireRole('owner', 'assistant', 'accountant'), async (c) => {
    const user = c.get('user');
    return c.json({ emails: await latestOutbox(c.env.DB, user.businesses.map((b) => b.id), Number(c.req.query('limit') ?? 1)) });
  });
  return { name: 'demo-app', basePath: '/demo-app', routes: r };
}

export const demoModule = createDemoModule();
export const demoAppModule = createDemoAppModule();
