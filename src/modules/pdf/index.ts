import { type Context, Hono } from 'hono';
import { requireFeature } from '../../core/auth';
import { ValidationError } from '../../core/errors';
import type { ModuleDef } from '../../core/module';
import type { AppEnv, Env } from '../../env';
import { signDownloadUrl } from '../access/downloads';
import { BrowserRenderingPdfEngine, type PdfEngine } from './engine';
import { renderDocument } from './render';
import { resolveSigningIdentity } from './signing';
import { assertClientCopyMayRelease, downloadFilename, hasStoredPdf, loadRenderDocument, r2Key, renderAndStore, renderDraftPdf } from './store';
import type { RenderVariant } from './types';

function parseVariant(value: string | undefined): RenderVariant {
  if (value === 'filed' || value === 'client') return value;
  throw new ValidationError('variant must be "filed" or "client".');
}

function parseDocumentId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new ValidationError('id must be a whole number.');
  return id;
}

function engineFor(env: Env): PdfEngine {
  if (!env.BROWSER) throw new ValidationError('Browser Rendering is not configured (the BROWSER binding is missing).');
  return new BrowserRenderingPdfEngine(env.BROWSER);
}

const routes = new Hono<AppEnv>();

/** Preview a document as HTML, for the web app's document page and editor. Drafts render too. */
routes.get('/documents/:id', requireFeature('income_documents'), async (c) => {
  const id = parseDocumentId(c.req.param('id'));
  const variant = parseVariant(c.req.query('variant') ?? 'client');
  const doc = await loadRenderDocument(c.env.DB, id, variant, { ownerTaxId: c.env.OWNER_TAX_ID ?? null, files: c.env.FILES });
  const html = renderDocument(doc, variant);
  return c.html(html);
});

/** Renders a finalized document to PDF, stores it in R2 and records its hash. Owner only. */
routes.post('/documents/:id/pdf', requireFeature('issue_documents'), async (c) => {
  const id = parseDocumentId(c.req.param('id'));
  const variant = parseVariant(c.req.query('variant') ?? 'client');
  const engine = engineFor(c.env);
  const signing = await resolveSigningIdentity(c.env.DB, c.env);
  const result = await renderAndStore(c.env.DB, c.env.FILES, engine, id, variant, { ownerTaxId: c.env.OWNER_TAX_ID ?? null, files: c.env.FILES }, signing);
  return c.json({ key: result.key, sha256: result.sha256 });
});

/**
 * "Show document" on a draft (R16 task 3): renders the draft straight to PDF bytes with a
 * diagonal DRAFT stamp, no number and no signature. Never stored in R2, never sent; each call
 * re-renders from the current draft.
 */
routes.get('/documents/:id/draft.pdf', requireFeature('income_documents'), async (c) => {
  const id = parseDocumentId(c.req.param('id'));
  const variant = parseVariant(c.req.query('variant') ?? 'client');
  const options = { ownerTaxId: c.env.OWNER_TAX_ID ?? null, files: c.env.FILES };
  // Check the document is still a draft before touching Browser Rendering, so a bad request
  // fails fast instead of behind an engine call.
  const preview = await loadRenderDocument(c.env.DB, id, variant, options);
  if (preview.status !== 'draft') {
    throw new ValidationError('This preview is for drafts. Use "View client copy" or "View filed copy" for a finalized document.');
  }
  const engine = engineFor(c.env);
  const bytes = await renderDraftPdf(c.env.DB, engine, id, variant, options);
  return new Response(bytes, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="draft.pdf"' },
  });
});

/**
 * Ensures the finalized document's PDF is rendered, signed and stored (R16 task 4): the first
 * call does the work through `renderAndStore` (which enforces rule 3's allocation gate for a
 * qualifying tax invoice's client copy); later calls reuse the stored copy. Either way, the
 * document is re-gated here before a link is handed out, so a document that loses its allocation
 * after being stored cannot still be opened. Returns the R2 key and the doc, for the caller to
 * sign its own link with the disposition and filename it wants (R17 task 3).
 */
async function ensureStored(c: Context<AppEnv>, id: number, variant: RenderVariant) {
  const options = { ownerTaxId: c.env.OWNER_TAX_ID ?? null, files: c.env.FILES };
  const doc = await loadRenderDocument(c.env.DB, id, variant, options);
  if (doc.number === null) throw new ValidationError('Finalize the document before viewing its PDF.');

  if (!(await hasStoredPdf(c.env.DB, id, variant))) {
    const engine = engineFor(c.env);
    const signing = await resolveSigningIdentity(c.env.DB, c.env, { require: true });
    await renderAndStore(c.env.DB, c.env.FILES, engine, id, variant, options, signing);
  } else {
    await assertClientCopyMayRelease(c.env.DB, id, variant);
  }
  return { doc, key: r2Key(doc.date, doc.seriesId, doc.number, variant) };
}

/** "View client copy" / "View filed copy": opens inline in a new tab, same as the draft preview. */
routes.post('/documents/:id/view', requireFeature('issue_documents'), async (c) => {
  const id = parseDocumentId(c.req.param('id'));
  const variant = parseVariant(c.req.query('variant') ?? 'client');
  const { key } = await ensureStored(c, id, variant);
  const { path, expiresAt } = await signDownloadUrl(c.env, key, 'issue_documents', undefined, { disposition: 'inline' });
  return c.json({ url: path, expiresAt });
});

/** "Download" next to each view button (R17 task 3): saves as "<type>-<number>-<client>.pdf". */
routes.post('/documents/:id/download', requireFeature('issue_documents'), async (c) => {
  const id = parseDocumentId(c.req.param('id'));
  const variant = parseVariant(c.req.query('variant') ?? 'client');
  const { doc, key } = await ensureStored(c, id, variant);
  const { path, expiresAt } = await signDownloadUrl(c.env, key, 'issue_documents', undefined, {
    disposition: 'attachment',
    filename: downloadFilename(doc),
  });
  return c.json({ url: path, expiresAt });
});

export const pdfModule: ModuleDef = {
  name: 'pdf',
  basePath: '/pdf',
  routes,
};

export { renderDocument } from './render';
export { BrowserRenderingPdfEngine, FakePdfEngine, type PdfEngine } from './engine';
export { resolveSigningIdentity } from './signing';
export { assertClientCopyMayRelease, hasStoredPdf, loadRenderDocument, r2Key, renderAndStore, renderDraftPdf, sha256Hex } from './store';
export type { RenderAndStoreResult } from './store';
export type { RenderClient, RenderDocument, RenderLine, RenderPayment, RenderVariant } from './types';
