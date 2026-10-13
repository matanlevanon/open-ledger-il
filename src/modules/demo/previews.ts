import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { requireRole } from '../../core/auth';
import { businessIdOf } from '../../core/business';
import { first, run, todayIsrael } from '../../core/db';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors';
import type { AppEnv, Env } from '../../env';
import { clientDisplayName } from '../clients/display';
import { placeFields } from '../contracts/fields-pdf';
import { signingPageHtml } from '../contracts/public-page';
import { renderContract } from '../contracts/render';
import { getContract, ownerSignatureImage, rowParts, viewHtml } from '../contracts/service';
import type { FieldValues } from '../contracts/types';
import { printedIdentity } from '../businesses/service';
import { displayNumber } from '../documents/types';
import { BrowserRenderingPdfEngine, type PdfEngine, renderDocument } from '../pdf';
import { loadRenderDocument } from '../pdf/store';
import type { RenderDocument, RenderPayment } from '../pdf/types';
import { senderName } from '../sending/share-page';
import { paymentLinkSettings } from '../sending/settings';
import { documentEmailHtml, documentEmailText } from '../sending/templates';
import { assertOwnRow } from './guard';

/**
 * R29 task 4: previews instead of actions. On a visitor's own draft:
 *   - Issue renders the finished PDF with the number shown as 0000 and a "Demo, not issued"
 *     watermark. Nothing is numbered, hashed or locked.
 *   - Send shows the email in the outbox preview. Nothing is sent.
 *   - Record payment renders the receipt that would be issued, watermarked.
 *   - A contract draft opens the real signing page in preview mode. Sign returns the signed PDF
 *     as a preview. Nothing is stored as signed.
 * Every route here reads only and writes nothing but the visitor's own outbox row.
 */

export const PREVIEW_TEXT_EN = 'DEMO · NOT ISSUED';
export const PREVIEW_TEXT_HE = 'הדגמה · לא הופק';
export const PREVIEW_NUMBER = '0000';

/** The preview watermark. It carries the demo watermark's class, so the global one is not added on top. */
export function injectPreviewWatermark(html: string, en = PREVIEW_TEXT_EN, he = PREVIEW_TEXT_HE): string {
  const markup = `<div class="ledger-demo-watermark ledger-demo-preview" aria-hidden="true"><span>${en}</span><span dir="rtl" lang="he">${he}</span></div>`;
  const style = `<style>.ledger-demo-watermark{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12mm;transform:rotate(-30deg);pointer-events:none;z-index:9999;color:rgba(200,30,30,.18);font:700 34pt sans-serif;white-space:nowrap}</style>`;
  const withStyle = html.includes('</head>') ? html.replace('</head>', `${style}</head>`) : `${style}${html}`;
  return withStyle.includes('</body>') ? withStyle.replace(/<\/body>(?![\s\S]*<\/body>)/, `${markup}</body>`) : `${withStyle}${markup}`;
}

export interface PreviewOptions {
  /** The PDF engine for previews. Tests pass a fake. Default: Browser Rendering. */
  engineFor?: (env: Env) => PdfEngine;
}

function defaultEngine(env: Env): PdfEngine {
  if (!env.BROWSER) throw new ValidationError('Browser Rendering is not configured (the BROWSER binding is missing).');
  return new BrowserRenderingPdfEngine(env.BROWSER);
}

const pdfResponse = (bytes: ArrayBuffer | Uint8Array, name: string) =>
  new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'private, no-store' } });

function idOf(c: Context<AppEnv>): number {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) throw new NotFoundError('Document', c.req.param('id'));
  return id;
}

function sessionKeyOf(c: Context<AppEnv>): string {
  const key = c.get('demo')?.sessionKey;
  // The admin's sample-set session issues for real. Previews are for visitors.
  if (!key) throw new ValidationError('Previews are for demo visitors.');
  return key;
}

/** The visitor's own draft, ready to render. Anything else is refused. */
async function ownDraft(c: Context<AppEnv>, variant: 'client' | 'filed' = 'client'): Promise<RenderDocument> {
  const id = idOf(c);
  // env.DB is the visitor's scoped view: another visitor's draft is not there at all.
  const db = c.env.DB;
  await assertOwnRow(db, 'documents', id, sessionKeyOf(c));
  const row = await first<{ business_id: number }>(db, 'SELECT business_id FROM documents WHERE id = ?', id);
  if (!row || row.business_id !== businessIdOf(c)) throw new NotFoundError('Document', id);
  const doc = await loadRenderDocument(db, id, variant, { ownerTaxId: c.env.OWNER_TAX_ID ?? null, files: c.env.FILES });
  if (doc.status !== 'draft') throw new ConflictError('not_draft', 'Previews are for your own drafts.');
  return doc;
}

async function renderPreview(engine: PdfEngine, doc: RenderDocument, variant: 'client' | 'filed'): Promise<ArrayBuffer> {
  return engine.renderPdf(injectPreviewWatermark(renderDocument(doc, variant)));
}

const paymentInput = z.object({
  method: z.enum(['bank_transfer', 'card', 'cheque', 'cash', 'other']).default('bank_transfer'),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amountMinor: z.number().int().positive().optional(),
  reference: z.string().max(200).nullish(),
});
const receiptInput = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), payments: z.array(paymentInput).max(20).optional() });
const sendInput = z.object({ to: z.string().email().max(200).optional(), message: z.string().max(2000).nullish() });
const signInput = z.object({ values: z.record(z.string(), z.unknown()).default({}), signaturePng: z.string().max(400_000), consent: z.boolean() });

async function json(c: Context<AppEnv>): Promise<unknown> {
  const text = await c.req.text();
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new ValidationError('The request body is not valid JSON.');
  }
}

function decodePng(dataUri: string): Uint8Array {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUri);
  if (!m) throw new ValidationError('Draw or type your signature.');
  const binary = atob(m[1]!);
  if (binary.length < 100) throw new ValidationError('Draw or type your signature.');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) throw new ValidationError('The signature image is not a PNG.');
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function identityOf(db: D1Database, businessId: number) {
  const identity = await printedIdentity(db, businessId, null);
  return { nameEn: identity.nameEn, nameHe: identity.nameHe };
}

/** The signing page in preview mode: a note on top, and Sign shows the returned PDF instead of storing it. */
function previewPage(html: string, lang: 'en' | 'he'): string {
  const note =
    lang === 'he'
      ? 'תצוגה מקדימה של ההדגמה. כך הלקוח רואה את דף החתימה. שום דבר לא נשמר כחתום.'
      : 'Demo preview. This is the page your client signs on. Nothing is stored as signed.';
  const bar = `<div role="note" style="background:#fff4d6;border-bottom:1px solid #e8c770;color:#1d1d1b;padding:8px 16px;font:14px/1.5 system-ui,sans-serif;text-align:center">${note}</div>`;
  // Runs before the page's own script: the signed PDF opens in the document pane and the download link.
  const hook = `<script>(function(){var f=window.fetch;window.fetch=function(u,o){return f.apply(this,arguments).then(function(r){if(String(u).slice(-5)!=='/sign'||!r.ok)return r;return r.clone().json().then(function(j){if(j&&j.pdfBase64){var b=atob(j.pdfBase64),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);var url=URL.createObjectURL(new Blob([a],{type:'application/pdf'}));var d=document.querySelector('iframe.doc');if(d)d.src=url;var l=document.querySelector('#done a');if(l){l.href=url;l.removeAttribute('download');l.target='_blank';}}return r;},function(){return r;});});};})();</script>`;
  return html.replace(/<body([^>]*)>/, `<body$1>${bar}${hook}`);
}

/** Routes under /api/demo-app for a visitor's previews. Mounted by createDemoAppModule. */
export function previewRoutes(options: PreviewOptions = {}): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const engineFor = options.engineFor ?? defaultEngine;
  const writer = requireRole('owner', 'assistant');

  r.post('/documents/:id/issue-preview', writer, async (c) => {
    const variant = c.req.query('variant') === 'filed' ? 'filed' : 'client';
    const doc = await ownDraft(c, variant);
    const finished: RenderDocument = { ...doc, number: 0, numberText: PREVIEW_NUMBER, status: 'final', signed: false, issuanceDate: doc.issuanceDate ?? doc.date };
    return pdfResponse(await renderPreview(engineFor(c.env), finished, variant), `DEMO-${doc.type}-${PREVIEW_NUMBER}.pdf`);
  });

  r.post('/documents/:id/receipt-preview', writer, async (c) => {
    const doc = await ownDraft(c);
    if (doc.kind !== 'demand' && doc.kind !== 'invoice') throw new ValidationError('Record a payment on a payment request, a transaction invoice or a tax invoice.');
    const input = receiptInput.parse(await json(c));
    const date = input.date ?? todayIsrael();
    // The same rule recordPayment follows: a demand after the switch pays as a tax invoice receipt.
    const code = doc.kind === 'invoice' ? '400' : doc.legalMode === 'murshe' ? '320' : '400';
    const type = (await first<{ name_en: string; name_he: string; kind: string }>(c.env.DB, 'SELECT name_en, name_he, kind FROM document_types WHERE code = ?', code))!;
    const payments: RenderPayment[] = (input.payments?.length ? input.payments : [{ method: 'bank_transfer' as const }]).map((p) => ({
      method: p.method ?? 'bank_transfer',
      methodDetail: null,
      paidOn: p.paidOn ?? date,
      reference: p.reference ?? null,
      amountMinor: p.amountMinor ?? doc.totalMinor,
      amountIlsMinor: null,
      currency: doc.currency,
    }));
    const paid = payments.reduce((sum, p) => sum + p.amountMinor, 0);
    const receipt: RenderDocument = {
      ...doc,
      type: code,
      typeNameEn: type.name_en,
      typeNameHe: type.name_he,
      kind: type.kind,
      number: 0,
      numberText: PREVIEW_NUMBER,
      status: 'final',
      signed: false,
      date,
      issuanceDate: date,
      payments,
      source: { typeNameEn: doc.typeNameEn, typeNameHe: doc.typeNameHe, number: null },
      ...(code === '400' ? { totalMinor: paid, subtotalMinor: paid, vatAmountMinor: 0, totalIlsMinor: null } : {}),
    };
    return pdfResponse(await renderPreview(engineFor(c.env), receipt, 'client'), `DEMO-${code}-${PREVIEW_NUMBER}.pdf`);
  });

  r.post('/documents/:id/send-preview', writer, async (c) => {
    const doc = await ownDraft(c);
    const input = sendInput.parse(await json(c));
    const db = c.env.DB;
    const businessId = businessIdOf(c);
    const row = (await first<{ client_id: number | null; brand_id: number | null }>(db, 'SELECT client_id, brand_id FROM documents WHERE id = ?', doc.id))!;
    const client = row.client_id === null ? null : await first<{ email: string | null; name_en: string | null; name_he: string | null }>(db, 'SELECT email, name_en, name_he FROM clients WHERE id = ?', row.client_id);
    const to = input.to ?? client?.email ?? null;
    if (!to) throw new ValidationError('This client has no email address on file. Provide one.');
    const sender = await senderName(db, businessId, row.brand_id);
    const number = displayNumber(doc.type, 0);
    const links = doc.kind === 'demand' ? await paymentLinkSettings(db, businessId) : { stripe: null, paypal: null };
    const clientName = client ? clientDisplayName(client, 'en') : '';
    const email = {
      to_addr: to,
      subject: `${number} from ${sender}`,
      html: documentEmailHtml(clientName, number, links, input.message ?? null, sender),
      text: documentEmailText(clientName, number, links, input.message ?? null, sender),
    };
    // The visitor's own outbox row, tagged with the session like every visitor row.
    await run(db, 'INSERT INTO demo_outbox (business_id, to_addr, subject, html, text) VALUES (?, ?, ?, ?, ?)', businessId, email.to_addr, email.subject, email.html, email.text);
    return c.json({ preview: true, email });
  });

  // The signing page, in preview mode, for a visitor's own contract draft.
  const contractOf = async (c: Context<AppEnv>) => {
    const id = idOf(c);
    await assertOwnRow(c.env.DB, 'contracts', id, sessionKeyOf(c));
    const row = await getContract(c.env.DB, businessIdOf(c), id);
    if (row.status !== 'draft') throw new ConflictError('not_draft', 'Previews are for your own drafts.');
    return row;
  };
  const langOf = (c: Context<AppEnv>, fallback: string): 'en' | 'he' => (c.req.query('lang') === 'he' || (c.req.query('lang') !== 'en' && fallback === 'he') ? 'he' : 'en');
  const baseOf = (c: Context<AppEnv>) => `/api/demo-app/sign-preview/c/${c.req.param('id')}`;

  r.get('/sign-preview/c/font/:name', (c) => c.redirect(`/api/sending/public/c/font/${encodeURIComponent(c.req.param('name'))}`, 302));

  r.get('/sign-preview/c/:id', writer, async (c) => {
    const row = await contractOf(c);
    const { fields } = await rowParts(c.env.DB, row);
    const identity = await printedIdentity(c.env.DB, row.business_id, null);
    const lang = langOf(c, row.language);
    const html = signingPageHtml({
      lang,
      base: baseOf(c),
      sender: identity.nameEn || identity.nameHe || 'Your supplier',
      title: row.title,
      kind: row.kind,
      signerEmail: row.signer_email ?? '',
      signerName: row.signer_name ?? '',
      fields,
      codeRequired: false,
      today: todayIsrael(),
    });
    return c.html(previewPage(html, lang));
  });

  r.get('/sign-preview/c/:id/view', writer, async (c) => {
    const row = await contractOf(c);
    const lang = langOf(c, row.language);
    return new Response(injectPreviewWatermark(await viewHtml(c.env, row, `${baseOf(c)}?lang=${lang}#signature`, lang)), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' },
    });
  });

  r.get('/sign-preview/c/:id/pdf', writer, async (c) => {
    const row = await contractOf(c);
    const { version, included, fields } = await rowParts(c.env.DB, row);
    const values = JSON.parse(row.field_values_json) as FieldValues;
    const rendered = renderContract({
      title: row.title,
      kind: row.kind,
      language: row.language,
      bodyEn: version.body_en,
      bodyHe: version.body_he,
      included: included ? { bodyEn: included.body_en, bodyHe: included.body_he } : null,
      fields,
      values,
      identity: await identityOf(c.env.DB, row.business_id),
      mode: 'pdf',
    });
    const raw = new Uint8Array(await engineFor(c.env).renderPdf(injectPreviewWatermark(rendered.html, 'DEMO · PREVIEW', 'הדגמה · תצוגה מקדימה')));
    const { bytes } = await placeFields(raw, rendered.boxes, { lock: (b) => b.group === 'owner', signatureImages: {} });
    return pdfResponse(bytes, `DEMO-${row.title.replace(/[^\w.-]+/g, '-').slice(0, 60)}.pdf`);
  });

  r.post('/sign-preview/c/:id/code', writer, async (c) => {
    await contractOf(c);
    return c.json({ ok: true });
  });

  r.post('/sign-preview/c/:id/decline', writer, async (c) => {
    await contractOf(c);
    return c.json({ ok: true, preview: true });
  });

  r.post('/sign-preview/c/:id/sign', writer, async (c) => {
    const row = await contractOf(c);
    const input = signInput.parse(await json(c));
    if (!input.consent) throw new ValidationError('Tick the box to agree to sign electronically.');
    const signature = decodePng(input.signaturePng);
    const { version, included, fields } = await rowParts(c.env.DB, row);
    const values = { ...(JSON.parse(row.field_values_json) as FieldValues) };
    for (const f of fields) {
      if (f.kind === 'signer_input') {
        const v = String(input.values[f.key] ?? '').trim().slice(0, 500);
        if (f.required && !v) throw new ValidationError(`Fill in ${f.labelEn || f.key}.`);
        values[f.key] = v;
      }
      if (f.kind === 'signed_date' && f.party === 'client') values[f.key] = todayIsrael();
    }
    const rendered = renderContract({
      title: row.title,
      kind: row.kind,
      language: row.language,
      bodyEn: version.body_en,
      bodyHe: version.body_he,
      included: included ? { bodyEn: included.body_en, bodyHe: included.body_he } : null,
      fields,
      values,
      identity: await identityOf(c.env.DB, row.business_id),
      mode: 'pdf',
    });
    const images: Record<string, Uint8Array> = {};
    const owner = row.owner_sign === 1 ? await ownerSignatureImage(c.env, row.business_id) : null;
    for (const f of fields) {
      if (f.kind !== 'signature') continue;
      if (f.party === 'client') images[f.key] = signature;
      else if (owner) images[f.key] = owner.bytes;
    }
    const raw = new Uint8Array(await engineFor(c.env).renderPdf(injectPreviewWatermark(rendered.html, 'DEMO · NOT SIGNED', 'הדגמה · לא נחתם')));
    const { bytes } = await placeFields(raw, rendered.boxes, { lock: () => true, signatureImages: images });
    // Nothing is stored. The page shows these bytes.
    return c.json({ preview: true, pdfBase64: toBase64(bytes) });
  });

  return r;
}
