import { withDemoWatermark } from '../demo/watermark';
import { isDemo } from '../demo/config';
import { demoMailerFor } from '../demo/outbox';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { actorFrom } from '../../core/audit';
import { todayIsrael } from '../../core/db';
import { requireFeature, requireRole } from '../../core/auth';
import { businessIdOf, listBusinessIds } from '../../core/business';
import { ValidationError } from '../../core/errors';
import type { ModuleDef } from '../../core/module';
import type { AppEnv, Env } from '../../env';
import { declareManualAuth } from '../access/route-guard';
import { printedIdentity } from '../businesses/service';
import { CEILING_ALERT_CRON } from '../ceiling/cron';
import { buildDocumentsServices, type DocumentsModuleOptions } from '../documents';
import { type Notifier, slackNotifier } from '../ita/notify';
import { BrowserRenderingPdfEngine, type PdfEngine } from '../pdf/engine';
import { type Mailer, ResendMailer } from '../sending/mailer';
import amaticHebrew from './assets/AmaticSC-Hebrew-Bold.woff2';
import dancingScript from './assets/DancingScript-Regular.woff2';
import { addSignButtons } from './fields-pdf';
import { closedPageHtml, type PageLang, signedPageHtml, signingPageHtml } from './public-page';
import {
  contractDetail,
  contractParts,
  contractFromToken,
  contractsCron,
  createContractDraft,
  createProformaFromContract,
  declineContract,
  listClientContracts,
  markViewed,
  newContractDefaults,
  openContractPdf,
  ownerSignatureImage,
  previewHtml,
  publicPdf,
  remindContract,
  requestCode,
  rowParts,
  sendContract,
  SIGN_PATH,
  signContract,
  updateContractDraft,
  viewHtml,
  voidContract,
  type ContractDeps,
} from './service';
import { createService, createTemplate, listServices, listTemplates, templateVersion, templateView, updateService, updateTemplate } from './templates';
import { contractInput, LINK_DAYS, serviceInput, templateInput, type FieldDef } from './types';

export * from './service';
export * from './templates';
export * from './types';
export { renderContract } from './render';
export { placeFields, readFields } from './fields-pdf';
export { FakeContractPdfEngine } from './engine';

export interface ContractsOptions {
  documentsOptions?: DocumentsModuleOptions;
  /** PDF engine. Default: Browser Rendering. Tests pass FakeContractPdfEngine. */
  engineFor?: (env: Env) => PdfEngine;
  /** Email. Default: Resend with MAIL_API_KEY, null without it. */
  mailerFor?: (env: Env) => Mailer | null;
  /** Slack alerts on signed and declined, and the 7-day reminder. */
  fetchFn?: typeof fetch;
  now?: () => Date;
}

function defaultEngine(env: Env): PdfEngine {
  if (!env.BROWSER) throw new ValidationError('Browser Rendering is not configured (the BROWSER binding is missing).');
  return withDemoWatermark(new BrowserRenderingPdfEngine(env.BROWSER), env);
}

function defaultMailer(env: Env): Mailer | null {
  return demoMailerFor(env) ?? (env.MAIL_API_KEY ? new ResendMailer(env.MAIL_API_KEY, env.MAIL_FROM) : null);
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

const sendInput = z.object({ channel: z.enum(['email', 'link']).default('link') });
const voidInput = z.object({ reason: z.string().trim().max(500).nullish() });
const signInput = z.object({
  values: z.record(z.string(), z.string().max(500)).default({}),
  code: z.string().trim().max(12).nullish(),
  signaturePng: z.string().max(600_000),
  consent: z.boolean(),
});
const declineInput = z.object({ reason: z.string().trim().max(1000).nullish() });

/** The 07:00 sweep shared with the ceiling alerts. No new cron trigger. */
export const CONTRACTS_CRON = CEILING_ALERT_CRON;

function depsFor(c: Context<AppEnv>, options: ContractsOptions, needEngine: boolean): ContractDeps {
  const env = c.env;
  return {
    env,
    engine: needEngine ? withDemoWatermark((options.engineFor ?? defaultEngine)(env), env) : { renderPdf: () => Promise.reject(new Error('No engine needed.')) },
    mailer: (options.mailerFor ?? defaultMailer)(env),
    notifier: notifierFor(env, options),
    baseUrl: baseUrl(c),
    now: options.now,
  };
}

function notifierFor(env: Env, options: ContractsOptions): Notifier {
  return slackNotifier(env.SLACK_WEBHOOK_URL, options.fetchFn ?? ((input, init) => fetch(input, init)));
}

function pdfResponse(object: R2ObjectBody, name: string, download: boolean): Response {
  const headers = new Headers({ 'content-type': 'application/pdf', 'cache-control': 'private, no-store' });
  headers.set('content-disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`);
  return new Response(object.body, { headers });
}

function pdfBytesResponse(bytes: Uint8Array, name: string, download: boolean): Response {
  const headers = new Headers({ 'content-type': 'application/pdf', 'cache-control': 'private, no-store' });
  headers.set('content-disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`);
  return new Response(bytes, { headers });
}

const fileName = (title: string, signed: boolean) => `${title.replace(/[^\w֐-׿.-]+/g, '-').slice(0, 80)}${signed ? '-signed' : ''}.pdf`;

/**
 * R25: /api/contracts. Templates and services: owner. Contracts: owner and assistant create,
 * send, remind and view. An accountant views signed contracts with the `contracts` switch on.
 */
export function createContractsModule(options: ContractsOptions = {}): ModuleDef {
  const r = new Hono<AppEnv>();
  const docOptions = options.documentsOptions ?? {};

  // Templates (Screen E).
  r.get('/templates', requireRole('owner', 'assistant'), async (c) => c.json({ templates: await listTemplates(c.env.DB, businessIdOf(c)) }));
  r.get('/templates/:id', requireRole('owner', 'assistant'), async (c) => c.json({ template: await templateView(c.env.DB, businessIdOf(c), idParam(c)) }));
  r.post('/templates', requireRole('owner'), async (c) => c.json({ template: await createTemplate(c.env.DB, actorFrom(c), templateInput.parse(await jsonBody(c))) }, 201));
  r.put('/templates/:id', requireRole('owner'), async (c) => c.json({ template: await updateTemplate(c.env.DB, actorFrom(c), idParam(c), templateInput.parse(await jsonBody(c))) }));

  // Services for the scope picker.
  r.get('/services', requireRole('owner', 'assistant'), async (c) =>
    c.json({ services: await listServices(c.env.DB, businessIdOf(c), { activeOnly: c.req.query('all') !== '1' }) }),
  );
  r.post('/services', requireRole('owner'), async (c) => c.json({ services: await createService(c.env.DB, actorFrom(c), serviceInput.parse(await jsonBody(c))) }, 201));
  r.put('/services/:id', requireRole('owner'), async (c) => c.json({ services: await updateService(c.env.DB, actorFrom(c), idParam(c), serviceInput.parse(await jsonBody(c))) }));

  // Contracts.
  r.get('/clients/:clientId', requireFeature('contracts'), async (c) =>
    c.json({ contracts: await listClientContracts(c.env.DB, businessIdOf(c), idParam(c, 'clientId'), c.get('user').role) }),
  );

  r.get('/new', requireRole('owner', 'assistant'), async (c) => {
    const clientId = Number(c.req.query('clientId'));
    const templateId = Number(c.req.query('templateId'));
    if (!Number.isInteger(clientId) || !Number.isInteger(templateId)) throw new ValidationError('Pick a client and a template.');
    const include = Number(c.req.query('includeTemplateId') ?? '');
    const businessId = businessIdOf(c);
    return c.json({
      ...(await newContractDefaults(c.env.DB, c.env, businessId, clientId, templateId, Number.isInteger(include) && include > 0 ? include : null)),
      linkDays: LINK_DAYS,
      ownerSignature: c.get('user').role === 'owner' && (await ownerSignatureImage(c.env, businessId)) !== null,
      emailReady: (options.mailerFor ?? defaultMailer)(c.env) !== null,
    });
  });

  r.post('/preview', requireRole('owner', 'assistant'), async (c) => c.html(await previewHtml(c.env, actorFrom(c), contractInput.parse(await jsonBody(c)))));

  r.post('/', requireRole('owner', 'assistant'), async (c) => {
    const id = await createContractDraft(c.env.DB, c.env, actorFrom(c), contractInput.parse(await jsonBody(c)));
    return c.json({ contract: await contractDetail(c.env.DB, businessIdOf(c), id, c.get('user').role) }, 201);
  });

  r.get('/:id', requireFeature('contracts'), async (c) => {
    const businessId = businessIdOf(c);
    const detail = await contractDetail(c.env.DB, businessId, idParam(c), c.get('user').role);
    // A draft edits against the current versions, the included template's too.
    const current = await contractParts(c.env.DB, businessId, { templateId: detail.templateId, includedId: detail.includedTemplate?.id ?? null });
    return c.json({
      contract: detail,
      currentTemplateVersion: current.version.version,
      currentFields: current.fields,
      emailReady: (options.mailerFor ?? defaultMailer)(c.env) !== null,
      ownerSignature: c.get('user').role === 'owner' && (await ownerSignatureImage(c.env, businessId)) !== null,
    });
  });

  r.put('/:id', requireRole('owner', 'assistant'), async (c) => {
    await updateContractDraft(c.env.DB, c.env, actorFrom(c), idParam(c), contractInput.parse(await jsonBody(c)));
    return c.json({ contract: await contractDetail(c.env.DB, businessIdOf(c), idParam(c), c.get('user').role) });
  });

  r.post('/:id/send', requireRole('owner', 'assistant'), async (c) => {
    const input = sendInput.parse(await jsonBody(c));
    const user = c.get('user');
    const result = await sendContract(depsFor(c, options, true), { ...actorFrom(c), name: user.name }, idParam(c), input);
    return c.json(result);
  });

  r.post('/:id/remind', requireRole('owner', 'assistant'), async (c) => {
    const input = sendInput.parse(await jsonBody(c));
    return c.json(await remindContract(depsFor(c, options, false), actorFrom(c), idParam(c), input));
  });

  r.post('/:id/void', requireRole('owner', 'assistant'), async (c) => {
    const input = voidInput.parse(await jsonBody(c));
    await voidContract(c.env.DB, actorFrom(c), idParam(c), input.reason ?? null);
    return c.json({ contract: await contractDetail(c.env.DB, businessIdOf(c), idParam(c), c.get('user').role) });
  });

  r.get('/:id/pdf', requireFeature('contracts'), async (c) => {
    const which = c.req.query('which') === 'signed' ? 'signed' : 'sent';
    const download = c.req.query('download') === '1';
    const { row, object } = await openContractPdf(c.env, actorFrom(c), idParam(c), which, download ? 'attachment' : 'inline');
    return pdfResponse(object, fileName(row.title, which === 'signed'), download);
  });

  r.post('/:id/proforma', requireRole('owner', 'assistant'), async (c) => {
    const ctx = { db: c.env.DB, actor: actorFrom(c), user: c.get('user'), services: buildDocumentsServices(docOptions, c.env) };
    const documentId = await createProformaFromContract(ctx, actorFrom(c), idParam(c));
    return c.json({ documentId }, 201);
  });

  return {
    name: 'contracts',
    basePath: '/contracts',
    routes: r,
    crons: [CONTRACTS_CRON],
    async scheduled(controller, env) {
      if (controller.cron !== CONTRACTS_CRON) return;
      const notifier = notifierFor(env, options);
      for (const businessId of await listBusinessIds(env.DB)) await contractsCron(env.DB, businessId, notifier, options.now ? options.now() : new Date());
    },
  };
}

function pageLang(c: Context<AppEnv>, fallback: 'en' | 'he' | 'both'): PageLang {
  const q = c.req.query('lang');
  if (q === 'he' || q === 'en') return q;
  return fallback === 'he' ? 'he' : 'en';
}

function requestOf(c: Context<AppEnv>) {
  return { ip: c.req.header('CF-Connecting-IP') ?? null, userAgent: c.req.header('User-Agent')?.slice(0, 300) ?? null };
}

/**
 * R25, Screen C: the signing link, under /api/sending/public/c/ so the existing Cloudflare Access
 * bypass for /api/sending/public lets the client in. The signed token and the contract row decide
 * everything. A route here never reads a contract, client or business the token does not name.
 */
export function createContractsPublicModule(options: ContractsOptions = {}): ModuleDef {
  const r = new Hono<AppEnv>();
  const manual = declareManualAuth('public signing link, token and contract row carry signature, expiry and status');
  const deps = (c: Context<AppEnv>): ContractDeps => ({
    env: c.env,
    engine: withDemoWatermark((options.engineFor ?? defaultEngine)(c.env), c.env),
    mailer: (options.mailerFor ?? defaultMailer)(c.env),
    notifier: notifierFor(c.env, options),
    baseUrl: baseUrl(c),
    now: options.now,
    demoCodes: isDemo(c.env),
  });
  const lightDeps = (c: Context<AppEnv>) => ({ env: c.env, now: options.now });

  // The handwriting fonts for a typed signature (OFL, see assets/OFL-*.txt). Public, no token.
  r.get('/font/:name', declareManualAuth('public font file for the signing page, no data'), (c) => {
    const name = c.req.param('name');
    const data = name === 'dancing.woff2' ? dancingScript : name === 'amatic-he.woff2' ? amaticHebrew : null;
    if (!data) return c.text('Not found', 404);
    return new Response(data, { headers: { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=86400' } });
  });

  r.get('/:token', manual, async (c) => {
    const link = await contractFromToken(lightDeps(c), c.req.param('token'));
    const base = `${new URL(c.req.url).origin}/api/sending/public/c/${c.req.param('token')}`;
    if (link.state === 'closed') return c.html(closedPageHtml(pageLang(c, link.row?.language ?? 'en'), link.message), 410);
    const row = link.row;
    const identity = await printedIdentity(c.env.DB, row.business_id, null);
    const sender = identity.nameEn || identity.nameHe || 'Your supplier';
    if (link.state === 'signed') return c.html(signedPageHtml(pageLang(c, row.language), base, sender, row.title, row.signed_at ?? ''));
    await markViewed(c.env.DB, row, requestOf(c));
    const { fields } = await rowParts(c.env.DB, row);
    return c.html(
      signingPageHtml({
        lang: pageLang(c, row.language),
        base,
        sender,
        title: row.title,
        kind: row.kind,
        signerEmail: row.signer_email ?? '',
        signerName: row.signer_name ?? '',
        fields,
        codeRequired: (options.mailerFor ?? defaultMailer)(c.env) !== null || isDemo(c.env),
        today: todayIsrael(options.now ? options.now() : new Date()),
      }),
    );
  });

  // The document as a web page, shown in the signing page. Readable on phones without a PDF viewer.
  r.get('/:token/view', manual, async (c) => {
    const link = await contractFromToken(lightDeps(c), c.req.param('token'));
    if (link.state !== 'open') return c.redirect(`${baseUrl(c)}${SIGN_PATH}${c.req.param('token')}/pdf`);
    const lang = pageLang(c, link.row.language);
    const page = `${baseUrl(c)}${SIGN_PATH}${c.req.param('token')}?lang=${lang}#signature`;
    const html = await viewHtml(c.env, link.row, page, lang === 'he' ? 'he' : 'en');
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' } });
  });

  r.get('/:token/pdf', manual, async (c) => {
    const link = await contractFromToken(lightDeps(c), c.req.param('token'));
    if (link.state === 'closed') return c.html(closedPageHtml(pageLang(c, link.row?.language ?? 'en'), link.message), 410);
    const object = await publicPdf(c.env, link.row);
    const name = fileName(link.row.title, link.state === 'signed');
    const download = c.req.query('download') === '1';
    if (link.state !== 'open') return pdfResponse(object, name, download);
    // Before signing: a Sign button in the client's signature box, linked back to the signing page.
    const row = link.row;
    const clientSigs = (await rowParts(c.env.DB, row)).fields.filter((f) => f.kind === 'signature' && f.party === 'client').map((f) => f.key);
    const page = `${baseUrl(c)}${SIGN_PATH}${c.req.param('token')}?lang=${pageLang(c, row.language)}#signature`;
    const bytes = await addSignButtons(new Uint8Array(await object.arrayBuffer()), clientSigs, page);
    return pdfBytesResponse(bytes, name, download);
  });

  r.post('/:token/code', manual, async (c) => {
    const link = await contractFromToken(lightDeps(c), c.req.param('token'));
    if (link.state !== 'open') return c.json({ error: { code: 'link_closed', message: link.state === 'signed' ? 'This document is already signed.' : link.message } }, 410);
    return c.json(await requestCode(deps(c), link.row, requestOf(c)));
  });

  r.post('/:token/sign', manual, async (c) => {
    const link = await contractFromToken(lightDeps(c), c.req.param('token'));
    if (link.state !== 'open') return c.json({ error: { code: 'link_closed', message: link.state === 'signed' ? 'This document is already signed.' : link.message } }, 410);
    const input = signInput.parse(await jsonBody(c));
    return c.json(await signContract(deps(c), link.row, requestOf(c), { ...input, code: input.code ?? null }));
  });

  r.post('/:token/decline', manual, async (c) => {
    const link = await contractFromToken(lightDeps(c), c.req.param('token'));
    if (link.state !== 'open') return c.json({ error: { code: 'link_closed', message: link.state === 'signed' ? 'This document is already signed.' : link.message } }, 410);
    const input = declineInput.parse(await jsonBody(c));
    await declineContract(deps(c), link.row, requestOf(c), input.reason ?? null);
    return c.json({ ok: true });
  });

  return { name: 'contracts-public', basePath: '/sending/public/c', routes: r };
}

export const contractsPublicModule = createContractsPublicModule();
