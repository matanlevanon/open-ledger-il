import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { actorFrom, auditStatement } from '../../core/audit';
import { requireFeature, requireRole } from '../../core/auth';
import { businessIdOf, listBusinessIds } from '../../core/business';
import { todayIsrael, transaction } from '../../core/db';
import { ConfigError, ValidationError } from '../../core/errors';
import type { ModuleDef } from '../../core/module';
import type { AppEnv, Env } from '../../env';
import { readerStatus } from '../ai';
import { CEILING_ALERT_CRON } from '../ceiling/cron';
import { slackNotifier } from '../ita/notify';
import { type Mailer, ResendMailer } from '../sending/mailer';
import { senderName } from '../sending/share-page';
import { type BusinessDocumentReader, businessDocumentReaderFor } from './reader';
import {
  alertExpiringDocuments,
  checkExtraction,
  confirmBusinessDocument,
  createShareLink,
  listActiveLinks,
  listBusinessDocuments,
  openBusinessDocument,
  revokeShareLink,
  uploadBusinessDocument,
} from './service';
import { ALLOWED_CONTENT_TYPES, BUSINESS_DOCUMENT_TYPES, DEFAULT_SHARE_DAYS, MAX_BYTES, EXPIRING_TYPES, SHARE_DAYS, TYPE_LABELS } from './types';

export * from './service';
export * from './types';
export { businessDocumentReaderFor, fakeBusinessDocumentReader, type BusinessDocumentReader } from './reader';

export interface BusinessDocumentsOptions {
  /** The certificate reader. Default: Anthropic or Gemini from Phase 0, null without a key. */
  readerFor?: (env: Env) => BusinessDocumentReader | null;
  /** Email for Share by email. Default: Resend with MAIL_API_KEY. */
  resolveMailer?: (env: Env) => Mailer;
  /** Slack for the expiry alert. Injected in tests. */
  fetchFn?: typeof fetch;
}

function defaultMailer(env: Env): Mailer {
  if (!env.MAIL_API_KEY) throw new ConfigError('Email is not set up. Add MAIL_API_KEY to send by email.');
  return new ResendMailer(env.MAIL_API_KEY);
}

function baseUrl(c: Context<AppEnv>): string {
  return c.env.PUBLIC_APP_URL || new URL(c.req.url).origin;
}

function idParam(c: Context<AppEnv>, name = 'id'): number {
  const id = Number(c.req.param(name));
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Not a valid id.');
  return id;
}

async function jsonBody(c: Context<AppEnv>): Promise<unknown> {
  const text = await c.req.text();
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new ValidationError('The request body is not valid JSON.');
  }
}

const dateOrNull = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish()
  .or(z.literal('').transform(() => null));
const confirmInput = z.object({ issueDate: dateOrNull, validUntil: dateOrNull });
const days = z.union(SHARE_DAYS.map((d) => z.literal(d)) as unknown as [z.ZodLiteral<1>, z.ZodLiteral<7>, z.ZodLiteral<30>]).default(DEFAULT_SHARE_DAYS);
const shareInput = z.object({ days, channel: z.enum(['link', 'whatsapp']).default('link') });
const emailInput = z.object({ days, to: z.string().trim().email(), message: z.string().trim().max(1000).nullish() });

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The 07:00 sweep shared with the ceiling alerts. No new cron trigger. */
export const BUSINESS_DOCUMENTS_CRON = CEILING_ALERT_CRON;

/**
 * R24 Phase C: /api/business-documents. Certificates per business. The owner uploads and
 * confirms. Owner and assistant view and share. An accountant views with the
 * `business_documents` switch on. Every view, download, share and shared opening is audited.
 */
export function createBusinessDocumentsModule(options: BusinessDocumentsOptions = {}): ModuleDef {
  const readerFor = options.readerFor ?? ((env: Env) => businessDocumentReaderFor(env));
  const resolveMailer = options.resolveMailer ?? defaultMailer;
  const r = new Hono<AppEnv>();

  r.get('/', requireFeature('business_documents'), async (c) => {
    const role = c.get('user').role;
    return c.json({
      documents: await listBusinessDocuments(c.env.DB, businessIdOf(c)),
      types: BUSINESS_DOCUMENT_TYPES.map((t) => ({ type: t, label: TYPE_LABELS[t], expires: EXPIRING_TYPES.includes(t) })),
      shareDays: SHARE_DAYS,
      reader: readerStatus(c.env),
      canManage: role === 'owner',
      canShare: role === 'owner' || role === 'assistant',
    });
  });

  r.post('/', requireRole('owner'), async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw new ValidationError('Choose a file to upload.');
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const result = await uploadBusinessDocument(c.env, readerFor(c.env), actorFrom(c), {
      businessId: businessIdOf(c),
      type: text(form.type) ?? '',
      fileName: file.name,
      contentType: file.type,
      bytes: await file.arrayBuffer(),
      issueDate: text(form.issueDate),
      validUntil: text(form.validUntil),
    });
    return c.json(result, 201);
  });

  // R24 C6: Add business reads a certificate before the business exists. Nothing is stored: the
  // parsed name and number fill the setup form, and the file is uploaded to the new business after.
  r.post('/read', requireRole('owner'), async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw new ValidationError('Choose a file to read.');
    if (!(file.type in ALLOWED_CONTENT_TYPES)) throw new ValidationError('Upload a PDF, JPG or PNG file.');
    if (file.size > MAX_BYTES) throw new ValidationError('The file is larger than 10 MB.');
    const reader = readerFor(c.env);
    if (!reader) return c.json({ extracted: null, check: checkExtraction(null, null), readError: null, reader: false });
    try {
      const extracted = await reader.read({ bytes: await file.arrayBuffer(), contentType: file.type });
      await transaction(c.env.DB, [auditStatement(c.env.DB, actorFrom(c), 'business_document.read', 'business_document', null, { type: extracted.type ?? null })]);
      return c.json({ extracted, check: checkExtraction(extracted, null), readError: null, reader: true });
    } catch (err) {
      return c.json({ extracted: null, check: checkExtraction(null, null), readError: err instanceof Error ? err.message : 'The document could not be read.', reader: true });
    }
  });

  r.post('/:id/confirm', requireRole('owner'), async (c) => {
    const input = confirmInput.parse(await jsonBody(c));
    return c.json({ document: await confirmBusinessDocument(c.env.DB, actorFrom(c), businessIdOf(c), idParam(c), input) });
  });

  r.get('/:id/file', requireFeature('business_documents'), async (c) => {
    const disposition = c.req.query('download') === '1' ? 'attachment' : 'inline';
    const { row, object } = await openBusinessDocument(c.env, actorFrom(c), businessIdOf(c), idParam(c), disposition);
    const headers = new Headers({ 'content-type': row.content_type, 'cache-control': 'private, no-store' });
    headers.set('content-disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
    return new Response(object.body, { headers });
  });

  r.post('/:id/share', requireRole('owner', 'assistant'), async (c) => {
    const input = shareInput.parse(await jsonBody(c));
    const link = await createShareLink(c.env, actorFrom(c), businessIdOf(c), idParam(c), { ...input, baseUrl: baseUrl(c) });
    return c.json({ link }, 201);
  });

  r.post('/:id/share/email', requireRole('owner', 'assistant'), async (c) => {
    const input = emailInput.parse(await jsonBody(c));
    const mailer = resolveMailer(c.env);
    const businessId = businessIdOf(c);
    const link = await createShareLink(c.env, actorFrom(c), businessId, idParam(c), { days: input.days, channel: 'email', sentTo: input.to, baseUrl: baseUrl(c) });
    const sender = await senderName(c.env.DB, businessId);
    const note = input.message ? `<p>${escapeHtml(input.message)}</p>` : '';
    await mailer.send({
      to: input.to,
      subject: `${sender} shared a document with you`,
      fromName: sender,
      html: `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5"><p>${escapeHtml(sender)} shared a document with you.</p>${note}<p><a href="${link.url}">Open the document</a></p><p>The link works until ${link.expiresAt.slice(0, 10)}.</p></body></html>`,
      text: `${sender} shared a document with you.\n${input.message ? `\n${input.message}\n` : ''}\nOpen it: ${link.url}\nThe link works until ${link.expiresAt.slice(0, 10)}.\n`,
    });
    return c.json({ link }, 201);
  });

  r.get('/links', requireRole('owner', 'assistant'), async (c) => c.json({ links: await listActiveLinks(c.env.DB, businessIdOf(c)) }));

  r.post('/links/:id/revoke', requireRole('owner', 'assistant'), async (c) => {
    await revokeShareLink(c.env.DB, actorFrom(c), businessIdOf(c), idParam(c));
    return c.json({ links: await listActiveLinks(c.env.DB, businessIdOf(c)) });
  });

  return {
    name: 'business-documents',
    basePath: '/business-documents',
    routes: r,
    crons: [BUSINESS_DOCUMENTS_CRON],
    async scheduled(controller, env) {
      if (controller.cron !== BUSINESS_DOCUMENTS_CRON) return;
      const notifier = slackNotifier(env.SLACK_WEBHOOK_URL, options.fetchFn ?? ((input, init) => fetch(input, init)));
      for (const businessId of await listBusinessIds(env.DB)) await alertExpiringDocuments(env.DB, businessId, todayIsrael(), notifier);
    },
  };
}

export const businessDocumentsModule = createBusinessDocumentsModule();
