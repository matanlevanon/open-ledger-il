import { ConflictError, NotFoundError, ValidationError } from '../../core/errors';
import { first } from '../../core/db';
import type { Env } from '../../env';
import { withDemoWatermark } from '../demo/watermark';
import { BrowserRenderingPdfEngine, assertClientCopyMayRelease, hasStoredPdf, r2Key, renderAndStore, resolveSigningIdentity } from '../pdf';

/** R41: the client copy of a final document, the same file the Ledger sends. */
export type ClientPdf = (env: Env, businessId: number, documentId: number) => Promise<Uint8Array>;

/**
 * The stored client copy when there is one, checked again against the allocation gate. Otherwise
 * it is rendered, signed and stored as Send does, so the API never hands out an unsigned copy.
 */
export const defaultClientPdf: ClientPdf = async (env, businessId, documentId) => {
  if (await hasStoredPdf(env.DB, documentId, 'client')) {
    await assertClientCopyMayRelease(env.DB, documentId, 'client');
    const row = await first<{ pdf_hashes: string | null; date: string; series_id: string; number: number | null }>(
      env.DB,
      'SELECT pdf_hashes, date, series_id, number FROM documents WHERE id = ? AND business_id = ?',
      documentId,
      businessId,
    );
    if (!row || row.number === null) throw new NotFoundError('PDF', documentId);
    const entries = row.pdf_hashes ? (JSON.parse(row.pdf_hashes) as { variant: string; key?: string }[]) : [];
    // The original copy. Older entries carry no key and sit at the original's path.
    const key = entries.find((e) => e.variant === 'client' && e.key)?.key ?? r2Key(row.date, row.series_id, row.number, 'client');
    const object = key ? await env.FILES.get(key) : null;
    if (!object) throw new NotFoundError('PDF', documentId);
    return new Uint8Array(await object.arrayBuffer());
  }
  if (!env.BROWSER) throw new ConflictError('pdf_unavailable', 'This Ledger cannot render PDFs right now. Open the document in the Ledger once, then try again.');
  const signing = await resolveSigningIdentity(env.DB, env, businessId, { require: true });
  if (!signing) throw new ValidationError('Set up the digital signature before the API can hand out PDFs.');
  const engine = withDemoWatermark(new BrowserRenderingPdfEngine(env.BROWSER), env);
  const stored = await renderAndStore(env.DB, env.FILES, engine, documentId, 'client', { ownerTaxId: env.OWNER_TAX_ID ?? null }, signing);
  return stored.bytes;
};
