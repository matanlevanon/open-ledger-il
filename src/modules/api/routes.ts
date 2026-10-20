import { type Context, Hono } from 'hono';
import { ZodError, z } from 'zod';
import type { AuditActor } from '../../core/audit';
import { auditAs } from '../../core/audit';
import { first, run, todayIsrael } from '../../core/db';
import { DomainError, mapDbError } from '../../core/errors';
import type { Env } from '../../env';
import { clientInput } from '../clients/schemas';
import { createClient } from '../clients/service';
import { draftInput } from '../documents/schemas';
import { createDraft } from '../documents/service';
import { isDemo } from '../demo/config';
import { ctxOf } from '../mcp/tools';
import { sha256Hex } from '../mcp/tokens';
import { type ApiKeyRow, rateLimit, verifyApiKey } from './keys';
import { buildOpenApi } from './openapi';
import { ApiClientInput, ApiDraftInput } from './schemas';
import { type ClientPdf, defaultClientPdf } from './pdf';
import { businessInfo, clientById, clientsPage, decodeCursor, documentById, documentsList, expensesPage, paymentsPage, suppliersPage } from './queries';

/**
 * R41: the public REST API at /v1, outside /api and outside Cloudflare Access. Every call carries
 * `Authorization: Bearer <key>` and `X-Business-Id` (the numeric id, or the business tax number).
 * JSON only, money in minor units with a currency, cursor paging. Write keys may create clients
 * and draft documents. No endpoint finalizes, sends, credits or deletes anything.
 */

export type ApiEnv = { Bindings: Env; Variables: { apiKey: ApiKeyRow; businessId: number } };

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const err = (code: string, message: string) => ({ error: { code, message } });

function errorResponse(c: Context<ApiEnv>, e: unknown): Response {
  const mapped = mapDbError(e);
  if (mapped instanceof ApiError) return c.json(err(mapped.code, mapped.message), mapped.status);
  if (mapped instanceof ZodError) {
    const named = mapped.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    return c.json(err('invalid', named ? `Some fields are not valid. ${named}` : 'Some fields are not valid.'), 422);
  }
  if (mapped instanceof DomainError) {
    const status = ([400, 401, 403, 404, 409, 422, 429] as const).find((s) => s === mapped.status) ?? 400;
    return c.json(err(mapped.code, mapped.message), status);
  }
  console.error('api_error', mapped instanceof Error ? mapped.name : 'unknown');
  return c.json(err('internal_error', 'Something went wrong. Try again.'), 500 as never);
}

const limitSchema = z.coerce.number().int().min(1).max(200).default(50);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const isoTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Use an ISO date and time, for example 2026-10-01T00:00:00Z.')
  .transform((v) => new Date(v).toISOString());
const paging = { limit: limitSchema, cursor: z.string().max(100).optional(), updatedSince: isoTime.optional() };

const ClientsQuery = z.object({ ...paging, q: z.string().trim().max(200).optional(), active: z.enum(['true', 'false']).optional() });
const DocumentsQuery = z.object({
  ...paging,
  type: z.string().max(200).optional(),
  status: z.enum(['draft', 'final', 'cancelled', 'awaiting_allocation', 'allocation_pending', 'allocation_refused']).optional(),
  from: date.optional(),
  to: date.optional(),
  clientId: z.coerce.number().int().positive().optional(),
});
const RangeQuery = z.object({ ...paging, from: date.optional(), to: date.optional() });
const ExpensesQuery = z.object({ ...paging, from: date.optional(), to: date.optional(), status: z.enum(['new', 'filed', 'not_expense', 'duplicate', 'returned']).optional() });
const PagingQuery = z.object(paging);

function idParam(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError(404, 'not_found', 'No such record.');
  return id;
}

/** The business named by X-Business-Id: its numeric id, or its tax number. Null when none matches. */
async function resolveBusiness(db: D1Database, header: string | undefined): Promise<number | null> {
  const value = (header ?? '').trim();
  if (!value) return null;
  if (/^\d{1,8}$/.test(value)) {
    const byId = await first<{ id: number }>(db, 'SELECT id FROM businesses WHERE id = ?', Number(value));
    if (byId) return byId.id;
  }
  const byTax = await first<{ id: number }>(db, 'SELECT id FROM businesses WHERE tax_id = ? ORDER BY id LIMIT 1', value);
  return byTax?.id ?? null;
}

function apiActor(c: Context<ApiEnv>): AuditActor {
  const key = c.get('apiKey');
  return {
    userId: null,
    email: `api:${key.name}`,
    role: 'owner',
    ip: c.req.header('CF-Connecting-IP') ?? null,
    userAgent: c.req.header('User-Agent')?.slice(0, 300) ?? null,
    businessId: c.get('businessId'),
  };
}

function requireWrite(c: Context<ApiEnv>): void {
  if (c.get('apiKey').scope !== 'write') throw new ApiError(403, 'scope_required', 'This call needs a key with the write scope.');
}

/** The first answer for this Idempotency-Key, or null. The same key with another body is 409. */
async function replay(c: Context<ApiEnv>, idemKey: string | undefined, bodyHash: string): Promise<Response | null> {
  if (!idemKey) return null;
  const row = await first<{ request_hash: string; status: number; response: string }>(
    c.env.DB,
    "SELECT request_hash, status, response FROM api_idempotency WHERE key_id = ? AND idem_key = ? AND created_at > ?",
    c.get('apiKey').id,
    idemKey,
    new Date(Date.now() - 86_400_000).toISOString(),
  );
  if (!row) return null;
  if (row.request_hash !== bodyHash) throw new ApiError(409, 'idempotency_conflict', 'This Idempotency-Key was used with another body.');
  return new Response(row.response, { status: row.status, headers: { 'content-type': 'application/json', 'Idempotent-Replayed': 'true' } });
}

async function remember(c: Context<ApiEnv>, idemKey: string | undefined, bodyHash: string, status: number, body: unknown): Promise<void> {
  if (!idemKey) return;
  await run(
    c.env.DB,
    `INSERT INTO api_idempotency (key_id, idem_key, business_id, request_hash, status, response, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (key_id, idem_key) DO UPDATE SET request_hash = excluded.request_hash, status = excluded.status, response = excluded.response, created_at = excluded.created_at`,
    c.get('apiKey').id,
    idemKey,
    c.get('businessId'),
    bodyHash,
    status,
    JSON.stringify(body),
    new Date().toISOString(),
  );
}

export interface ApiRoutesOptions {
  /** The client copy PDF. Tests pass a fake. */
  clientPdf?: ClientPdf;
  today?: () => string;
}

export function createApiRoutes(options: ApiRoutesOptions = {}): Hono<ApiEnv> {
  const r = new Hono<ApiEnv>();
  const today = options.today ?? (() => todayIsrael());
  const clientPdf = options.clientPdf ?? defaultClientPdf;

  r.onError((e, c) => errorResponse(c, e));
  r.notFound((c) => c.json(err('not_found', 'No such endpoint.'), 404));

  // The spec needs no key, so a service can read it before it has one.
  r.get('/openapi.json', (c) => c.json(buildOpenApi(new URL(c.req.url).origin)));

  // The demo reads only: a row made here would carry no visitor tag and join the shared sample.
  r.use('*', async (c, next) => {
    if (isDemo(c.env) && c.req.method !== 'GET') return c.json(err('demo_read_only', 'The demo API reads only.'), 403);
    await next();
  });

  r.use('*', async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!presented) return c.json(err('unauthorized', 'A valid API key is required.'), 401);
    const businessId = await resolveBusiness(c.env.DB, c.req.header('X-Business-Id'));
    const verdict = await verifyApiKey(c.env.DB, presented, businessId);
    if (!verdict.ok) return c.json(err(verdict.code, verdict.message), verdict.status);
    const wait = await rateLimit(c.env.DB, verdict.key.id);
    if (wait !== null) {
      return c.json(err('rate_limited', 'More than 120 requests in one minute. Wait and try again.'), 429, { 'Retry-After': String(wait) });
    }
    c.set('apiKey', verdict.key);
    c.set('businessId', businessId!);
    await next();
  });

  r.get('/business', async (c) => c.json(await businessInfo(c.env.DB, c.get('businessId'), today())));

  r.get('/clients', async (c) => {
    const q = ClientsQuery.parse(c.req.query());
    return c.json(
      await clientsPage(c.env.DB, c.get('businessId'), {
        q: q.q,
        active: q.active === undefined ? undefined : q.active === 'true',
        updatedSince: q.updatedSince,
        afterId: decodeCursor(q.cursor),
        limit: q.limit,
      }),
    );
  });

  r.get('/clients/:id', async (c) => c.json(await clientById(c.env.DB, c.get('businessId'), idParam(c.req.param('id')))));

  r.get('/documents', async (c) => {
    const q = DocumentsQuery.parse(c.req.query());
    const types = q.type ? q.type.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
    return c.json(
      await documentsList(
        c.env.DB,
        c.get('businessId'),
        { types, status: q.status, from: q.from, to: q.to, clientId: q.clientId, updatedSince: q.updatedSince, afterId: decodeCursor(q.cursor), limit: q.limit },
        today(),
      ),
    );
  });

  r.get('/documents/:id', async (c) => c.json(await documentById(c.env.DB, c.get('businessId'), idParam(c.req.param('id')), today())));

  r.get('/documents/:id/pdf', async (c) => {
    const id = idParam(c.req.param('id'));
    const doc = await first<{ status: string; number: number | null }>(c.env.DB, 'SELECT status, number FROM documents WHERE id = ? AND business_id = ?', id, c.get('businessId'));
    if (!doc) throw new ApiError(404, 'not_found', 'No such document.');
    if (doc.status !== 'final' || doc.number === null) throw new ApiError(409, 'not_final', 'Only a final document has a PDF.');
    const bytes = await clientPdf(c.env, c.get('businessId'), id);
    return new Response(bytes, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="document-${id}.pdf"`, 'cache-control': 'no-store' } });
  });

  r.get('/payments', async (c) => {
    const q = RangeQuery.parse(c.req.query());
    return c.json(await paymentsPage(c.env.DB, c.get('businessId'), { from: q.from, to: q.to, updatedSince: q.updatedSince, afterId: decodeCursor(q.cursor), limit: q.limit }));
  });

  r.get('/expenses', async (c) => {
    const q = ExpensesQuery.parse(c.req.query());
    return c.json(
      await expensesPage(c.env.DB, c.get('businessId'), { from: q.from, to: q.to, status: q.status, updatedSince: q.updatedSince, afterId: decodeCursor(q.cursor), limit: q.limit }),
    );
  });

  r.get('/suppliers', async (c) => {
    const q = PagingQuery.parse(c.req.query());
    return c.json(await suppliersPage(c.env.DB, c.get('businessId'), { updatedSince: q.updatedSince, afterId: decodeCursor(q.cursor), limit: q.limit }));
  });

  r.post('/clients', async (c) => {
    requireWrite(c);
    const raw = await c.req.text();
    const idemKey = c.req.header('Idempotency-Key')?.slice(0, 200) || undefined;
    const bodyHash = await sha256Hex(`POST /clients\n${raw}`);
    const replayed = await replay(c, idemKey, bodyHash);
    if (replayed) return replayed;
    const input = ApiClientInput.parse(JSON.parse(raw || '{}'));
    const actor = apiActor(c);
    const parsed = clientInput.parse({ nameEn: input.nameEn, nameHe: input.nameHe, email: input.email, companyId: input.companyId, notes: input.notes });
    const id = await createClient(c.env.DB, actor, parsed, null);
    await auditAs(c.env.DB, actor, 'api.client.create', 'client', id, { key: c.get('apiKey').name });
    const body = await clientById(c.env.DB, c.get('businessId'), id);
    await remember(c, idemKey, bodyHash, 201, body);
    return c.json(body, 201);
  });

  r.post('/documents', async (c) => {
    requireWrite(c);
    const raw = await c.req.text();
    const idemKey = c.req.header('Idempotency-Key')?.slice(0, 200) || undefined;
    const bodyHash = await sha256Hex(`POST /documents\n${raw}`);
    const replayed = await replay(c, idemKey, bodyHash);
    if (replayed) return replayed;
    const input = ApiDraftInput.parse(JSON.parse(raw || '{}'));
    const actor = apiActor(c);
    const businessId = c.get('businessId');
    const draft = draftInput.parse({
      type: input.type,
      clientId: input.clientId ?? null,
      date: input.date,
      dueDate: input.dueDate ?? null,
      currency: input.currency,
      notes: input.notes ?? null,
      lines: input.lines.map((l) => ({ description: l.description, quantityMilli: l.quantityMilli ?? 1000, unitPriceMinor: l.unitPriceMinor, discountMinor: l.discountMinor ?? 0 })),
    });
    const id = await createDraft({ ...ctxOf({ db: c.env.DB, actor, businessId, today }), actor }, draft);
    await auditAs(c.env.DB, actor, 'api.document.draft', 'document', id, { key: c.get('apiKey').name, type: input.type });
    const base = (c.env.PUBLIC_APP_URL || new URL(c.req.url).origin).replace(/\/+$/, '');
    const body = { ...(await documentById(c.env.DB, businessId, id, today())), editUrl: `${base}/income/documents/${id}/edit` };
    await remember(c, idemKey, bodyHash, 201, body);
    return c.json(body, 201);
  });

  // Anything else under /v1 is a JSON 404, never the web app's page.
  r.all('*', (c) => c.json(err('not_found', 'No such endpoint.'), 404));

  return r;
}

export const apiRoutes = createApiRoutes();
