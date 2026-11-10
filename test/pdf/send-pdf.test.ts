import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { run } from '../../src/core/db';
import { finalizeDocument } from '../../src/core/numbering';
import { FakePdfEngine, type PdfEngine } from '../../src/modules/pdf/engine';
import { pdfForSend, renderAndStore } from '../../src/modules/pdf/store';
import { insertClient, insertDocument } from '../fixtures/pdf/db';
import { OWNER_ACTOR, db, makeSeries } from '../helpers';

// R48: the PDF made at finalize is the one the first send attaches. A failed render says so.

let seriesId: string;

beforeEach(async () => {
  seriesId = await makeSeries();
});

class CountingEngine implements PdfEngine {
  calls = 0;
  async renderPdf(html: string): Promise<ArrayBuffer> {
    this.calls += 1;
    return new FakePdfEngine().renderPdf(html);
  }
}

class BrokenEngine implements PdfEngine {
  async renderPdf(): Promise<ArrayBuffer> {
    throw new Error('TimeoutError: Navigation timeout of 30000 ms exceeded');
  }
}

async function finalDoc(): Promise<number> {
  const clientId = await insertClient();
  const id = await insertDocument(seriesId, { clientId });
  await finalizeDocument(db(), id, { actor: OWNER_ACTOR });
  return id;
}

describe('pdfForSend', () => {
  it('reuses the original stored at finalize for the first send, with no new render', async () => {
    const id = await finalDoc();
    const stored = await renderAndStore(db(), env.FILES, new FakePdfEngine(), id, 'client', { ownerTaxId: null });
    const engine = new CountingEngine();
    const pdf = await pdfForSend(db(), env.FILES, engine, id, 'client', { ownerTaxId: null });
    expect(engine.calls).toBe(0);
    expect(pdf.key).toBe(stored.key);
    expect(new TextDecoder().decode(pdf.bytes)).toContain('מקור');
  });

  it('renders now when nothing is stored, and a new copy once the document was sent', async () => {
    const id = await finalDoc();
    const engine = new CountingEngine();
    const first = await pdfForSend(db(), env.FILES, engine, id, 'client', { ownerTaxId: null });
    expect(engine.calls).toBe(1);
    await run(db(), "INSERT INTO send_log (document_id, channel, to_address, status) VALUES (?, 'email', 'a@example.com', 'sent')", id);
    const second = await pdfForSend(db(), env.FILES, engine, id, 'client', { ownerTaxId: null });
    expect(engine.calls).toBe(2);
    expect(second.key).not.toBe(first.key);
    expect(new TextDecoder().decode(second.bytes)).toContain('העתק');
  });

  it('says the PDF was not created when the browser fails, and stores nothing', async () => {
    const id = await finalDoc();
    await expect(pdfForSend(db(), env.FILES, new BrokenEngine(), id, 'client', { ownerTaxId: null })).rejects.toMatchObject({
      code: 'pdf_not_created',
      status: 409,
    });
    const row = await db().prepare('SELECT pdf_hashes FROM documents WHERE id = ?').bind(id).first<{ pdf_hashes: string | null }>();
    expect(row?.pdf_hashes ?? null).toBeNull();
  });
});
