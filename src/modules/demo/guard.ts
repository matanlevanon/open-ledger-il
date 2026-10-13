import type { MiddlewareHandler } from 'hono';
import { actorFrom, auditAs } from '../../core/audit';
import { first } from '../../core/db';
import { DomainError, ForbiddenError, NotFoundError } from '../../core/errors';
import type { AppEnv } from '../../env';
import { slackNotifier } from '../ita/notify';
import { type CapKind, checkCap, countUse } from './caps';
import { demoCaps, isDemo } from './config';
import { refreshFingerprint } from './sample';
import { scopedDb } from './scoped-db';
import { injectWatermark } from './watermark';

/**
 * R26, R29: the demo guard, after sign-in on every /api route, only with DEMO_MODE=1.
 *
 * Every visitor opens the same sample businesses. The sample data is read-only: a visitor changes
 * only rows it created in this session. Reads and inserts go through a scoped database
 * (scoped-db.ts), so a visitor sees the sample set plus its own drafts and nothing of another
 * visitor's. Writes pass only through the list below, and a write on a row names the row it
 * touches, which must carry this session's key. Issuing, sending, recording a payment and signing
 * never run for a visitor: the web app calls the previews in /api/demo-app instead.
 *
 * The admin's "Open the sample set" session is the only one that changes the sample set. Its
 * writes are audited, and each one refreshes the sample set's fingerprint.
 */

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type Tagged = 'clients' | 'documents' | 'contracts' | 'expenses' | 'suppliers';

interface Rule {
  method: string;
  pattern: RegExp;
  /** The row the write touches: its table, and the path group holding its id. Absent: a create or a pure read. */
  owns?: Tagged;
}

/** Writes a visitor may make. Everything else is refused as read-only. */
const VISITOR_WRITES: Rule[] = [
  { method: 'POST', pattern: /^\/api\/clients$/ },
  { method: 'PATCH', pattern: /^\/api\/clients\/(\d+)$/, owns: 'clients' },
  { method: 'POST', pattern: /^\/api\/clients\/(\d+)\/(activate|deactivate|contacts)$/, owns: 'clients' },
  { method: 'PATCH', pattern: /^\/api\/clients\/(\d+)\/contacts\/\d+$/, owns: 'clients' },
  { method: 'DELETE', pattern: /^\/api\/clients\/(\d+)\/contacts\/\d+$/, owns: 'clients' },
  { method: 'POST', pattern: /^\/api\/documents$/ },
  { method: 'PATCH', pattern: /^\/api\/documents\/(\d+)$/, owns: 'documents' },
  { method: 'DELETE', pattern: /^\/api\/documents\/(\d+)$/, owns: 'documents' },
  // A copy of a sample document is a new private draft. The source is only read.
  { method: 'POST', pattern: /^\/api\/documents\/\d+\/duplicate$/ },
  // Viewing a sample document's PDF stores it once, as a real owner's view does.
  { method: 'POST', pattern: /^\/api\/pdf\/documents\/\d+\/(view|download)$/ },
  { method: 'POST', pattern: /^\/api\/expenses\/upload$/ },
  { method: 'POST', pattern: /^\/api\/expenses\/suppliers$/ },
  { method: 'PATCH', pattern: /^\/api\/expenses\/suppliers\/(\d+)$/, owns: 'suppliers' },
  { method: 'PATCH', pattern: /^\/api\/expenses\/(\d+)(\/review)?$/, owns: 'expenses' },
  { method: 'POST', pattern: /^\/api\/expenses\/(\d+)\/status$/, owns: 'expenses' },
  { method: 'POST', pattern: /^\/api\/contracts$/ },
  { method: 'POST', pattern: /^\/api\/contracts\/preview$/ },
  { method: 'PUT', pattern: /^\/api\/contracts\/(\d+)$/, owns: 'contracts' },
  { method: 'PATCH', pattern: /^\/api\/me\/preferences$/ },
  // The previews check the draft's owner themselves.
  { method: 'POST', pattern: /^\/api\/demo-app\// },
  // A visitor's Tax Authority renewal answers at once and stores nothing (ita/routes.ts).
  { method: 'POST', pattern: /^\/api\/ita\/refresh$/ },
];

/** Reads that would write the sample set. The Tax Authority routes answer a visitor themselves (ita/routes.ts). */
const VISITOR_BLOCKED_READS: RegExp[] = [];

export function visitorRule(method: string, path: string): Rule | null {
  return VISITOR_WRITES.find((r) => r.method === method && r.pattern.test(path)) ?? null;
}

/** Kept for callers that only ask yes or no. */
export function visitorMayWrite(method: string, path: string): boolean {
  return visitorRule(method, path) !== null;
}

/** Which cap a request counts against, if any. */
export function capKindOf(method: string, path: string): CapKind | null {
  if (method === 'POST' && /^\/api\/documents$/.test(path)) return 'documents';
  if (method === 'POST' && /^\/api\/documents\/\d+\/duplicate$/.test(path)) return 'documents';
  if (/^\/api\/pdf\/documents\/\d+\/(pdf|view|download|draft\.pdf)$/.test(path)) return 'pdfs';
  if (method === 'POST' && /^\/api\/demo-app\/(documents|contracts|sign-preview)\//.test(path)) return 'pdfs';
  if (method === 'POST' && /^\/api\/expenses\/upload$/.test(path)) return 'uploads';
  if (method === 'POST' && /^\/api\/contracts$/.test(path)) return 'contracts';
  return null;
}

export const READ_ONLY_MESSAGE = 'Read-only in the demo. The sample data is shared by every visitor. Create a draft of your own to try this.';

export class DemoReadOnlyError extends DomainError {
  constructor() {
    super('demo_read_only', READ_ONLY_MESSAGE, 403);
  }
}

/** Refuses a write on a row this session did not create. Another visitor's row reads as missing. */
export async function assertOwnRow(db: D1Database, table: Tagged, id: number, sessionKey: string): Promise<void> {
  const row = await first<{ demo_session_id: string | null }>(db, `SELECT demo_session_id FROM ${table} WHERE id = ?`, id);
  if (!row) return; // The route answers its own 404.
  if (row.demo_session_id === sessionKey) return;
  if (row.demo_session_id === null) throw new DemoReadOnlyError();
  throw new NotFoundError(table === 'clients' ? 'Client' : table === 'documents' ? 'Document' : table === 'contracts' ? 'Contract' : table === 'expenses' ? 'Expense' : 'Supplier', id);
}

export function demoGuard(options: { fetchFn?: typeof fetch } = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    const demo = c.get('demo');
    if (!isDemo(c.env) || !user || !demo) return next();
    const method = c.req.method;
    const path = c.req.path;
    const raw = c.env.DB;
    // Every read sees the sample set plus this session's rows. The outbox files a client email
    // under the business of this request.
    c.env = { ...c.env, DB: scopedDb(raw, demo.admin ? null : demo.sessionKey), DEMO_BUSINESS_ID: String(user.businessId) };
    const notifier = slackNotifier(c.env.SLACK_WEBHOOK_URL, options.fetchFn ?? ((i, init) => fetch(i, init)));

    let kind: CapKind | null = null;
    if (demo.admin) {
      if (WRITE.has(method)) await auditAs(raw, actorFrom(c), 'demo.admin_write', 'route', path, { method, admin: demo.adminEmail });
    } else {
      if (!demo.sessionKey) throw new ForbiddenError('Open the demo from its start page.');
      if (VISITOR_BLOCKED_READS.some((p) => p.test(path))) throw new DemoReadOnlyError();
      if (WRITE.has(method)) {
        const rule = visitorRule(method, path);
        if (!rule) throw new DemoReadOnlyError();
        if (rule.owns) await assertOwnRow(raw, rule.owns, Number(rule.pattern.exec(path)![1]), demo.sessionKey);
      }
      kind = capKindOf(method, path);
      if (kind) {
        if (kind === 'uploads' && Number(c.req.header('Content-Length') ?? 0) > demoCaps(c.env).uploadBytes) {
          throw new DomainError('demo_upload_size', `Demo uploads are up to ${Math.round(demoCaps(c.env).uploadBytes / 1048576)} MB.`, 413);
        }
        await checkCap({ ...c.env, DB: raw }, notifier, kind, demo.sessionKey);
      }
    }

    await next();

    if (kind && c.res.status < 300) await countUse({ ...c.env, DB: raw }, kind, demo.sessionKey);
    if (demo.admin && WRITE.has(method) && c.res.status < 300) await refreshFingerprint(raw, user.businessId);
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
