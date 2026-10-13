import type { MiddlewareHandler } from 'hono';
import { actorFrom, auditAs } from '../../core/audit';
import { first } from '../../core/db';
import { DomainError, ForbiddenError } from '../../core/errors';
import type { AppEnv } from '../../env';
import { slackNotifier } from '../ita/notify';
import { type CapKind, checkCap, countUse, DemoCapError } from './caps';
import { demoCaps, isDemo } from './config';
import { injectWatermark } from './watermark';

/**
 * R26: the demo guard, after sign-in on every /api route, only with DEMO_MODE=1.
 *
 * A visitor does what a real owner does with documents, clients, expenses and contracts. The
 * Ledger's own locks stay in charge: drafts edit and delete, final documents only cancel and
 * credit, signed contracts never change. Settings stay visible and read-only, except the switch
 * to עוסק מורשה and Add a business. The sample set opened from /admin writes anything, audited.
 */

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Writes a visitor may make. Everything else is a Settings write and is refused. */
const ALLOWED: { method?: string; pattern: RegExp }[] = [
  { pattern: /^\/api\/clients(\/|$)/ },
  { pattern: /^\/api\/documents(\/|$)/ },
  { pattern: /^\/api\/pdf\// },
  { pattern: /^\/api\/sending\/documents\// },
  { pattern: /^\/api\/expenses(\/(?!categories|settings|import)|$)/ },
  { pattern: /^\/api\/contracts(\/(?!templates|services)|$)/ },
  { pattern: /^\/api\/recurring(\/|$)/ },
  { pattern: /^\/api\/ita\/(allocations|buyer|refresh)(\/|$)/ },
  { pattern: /^\/api\/exports\// },
  { pattern: /^\/api\/reports\// },
  { method: 'POST', pattern: /^\/api\/legal-mode\/switch$/ },
  { method: 'POST', pattern: /^\/api\/businesses$/ },
  { method: 'PUT', pattern: /^\/api\/dashboard\/layout$/ },
  { method: 'PATCH', pattern: /^\/api\/me\/preferences$/ },
  { pattern: /^\/api\/demo-app\// },
];

export function visitorMayWrite(method: string, path: string): boolean {
  return ALLOWED.some((a) => (!a.method || a.method === method) && a.pattern.test(path));
}

/** Which cap a request counts against, if any. */
export function capKindOf(method: string, path: string): CapKind | null {
  if (method === 'POST' && /^\/api\/documents$/.test(path)) return 'documents';
  if (method === 'POST' && /^\/api\/documents\/\d+\/(convert|duplicate|revise|record-payment|credit)$/.test(path)) return 'documents';
  if (/^\/api\/pdf\/documents\/\d+\/(pdf|view|download|draft\.pdf)$/.test(path)) return 'pdfs';
  if (method === 'POST' && /^\/api\/contracts\/\d+\/send$/.test(path)) return 'pdfs';
  if (method === 'POST' && /^\/api\/sending\/documents\/\d+\/(send|whatsapp-link)$/.test(path)) return 'pdfs';
  if (method === 'POST' && /^\/api\/expenses\/upload$/.test(path)) return 'uploads';
  if (method === 'POST' && /^\/api\/contracts$/.test(path)) return 'contracts';
  if (method === 'POST' && /^\/api\/businesses$/.test(path)) return 'businesses';
  return null;
}

export const READ_ONLY_MESSAGE = 'Demo: settings are read-only. In your own Ledger you change this in Settings.';

export function demoGuard(options: { fetchFn?: typeof fetch } = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    const demo = c.get('demo');
    if (!isDemo(c.env) || !user || !demo) return next();
    // The outbox mailer files a client email under the business of this request.
    c.env = { ...c.env, DEMO_BUSINESS_ID: String(user.businessId) };
    const method = c.req.method;
    const path = c.req.path;
    const notifier = slackNotifier(c.env.SLACK_WEBHOOK_URL, options.fetchFn ?? ((i, init) => fetch(i, init)));

    let kind: CapKind | null = null;
    if (demo.admin) {
      if (WRITE.has(method)) await auditAs(c.env.DB, actorFrom(c), 'demo.admin_write', 'route', path, { method, admin: demo.adminEmail });
    } else {
      if (WRITE.has(method) && !visitorMayWrite(method, path)) throw new ForbiddenError(READ_ONLY_MESSAGE);
      kind = capKindOf(method, path);
      if (kind === 'businesses') {
        const owned = (await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM user_businesses WHERE user_id = ? AND role = 'owner'", user.id))!.n;
        if (owned >= demoCaps(c.env).businesses) throw new DemoCapError('businesses');
      } else if (kind) {
        if (kind === 'uploads' && Number(c.req.header('Content-Length') ?? 0) > demoCaps(c.env).uploadBytes) {
          throw new DomainError('demo_upload_size', `Demo uploads are up to ${Math.round(demoCaps(c.env).uploadBytes / 1048576)} MB.`, 413);
        }
        await checkCap(c.env, notifier, kind, demo.sandboxId);
      }
    }

    await next();

    if (kind && kind !== 'businesses' && c.res.status < 300) await countUse(c.env, kind, demo.sandboxId);
    const type = c.res.headers.get('content-type') ?? '';
    if (type.startsWith('text/html') && (path.startsWith('/api/pdf/') || path.startsWith('/api/contracts/preview'))) {
      const html = injectWatermark(await c.res.text());
      c.res = new Response(html, { status: c.res.status, headers: c.res.headers });
    }
    const disposition = c.res.headers.get('content-disposition');
    if (disposition && /attachment/i.test(disposition) && !/filename\*?=(UTF-8'')?"?DEMO-/i.test(disposition)) {
      const headers = new Headers(c.res.headers);
      headers.set('content-disposition', disposition.replace(/filename(\*?)=(UTF-8'')?"?/i, (m) => `${m}DEMO-`));
      c.res = new Response(c.res.body, { status: c.res.status, headers });
    }
  };
}
