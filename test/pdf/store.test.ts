import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { run } from '../../src/core/db';
import { finalizeDocument } from '../../src/core/numbering';
import { FakePdfEngine } from '../../src/modules/pdf/engine';
import { renderDocument } from '../../src/modules/pdf/render';
import { hasStoredPdf, loadRenderDocument, r2Key, renderAndStore, renderDraftPdf, sha256Hex } from '../../src/modules/pdf/store';
import { insertClient, insertDocument } from '../fixtures/pdf/db';
import { OWNER_ACTOR, db, makeSeries } from '../helpers';

let seriesId: string;

beforeEach(async () => {
  seriesId = await makeSeries();
});

describe('r2Key', () => {
  it('builds docs/<year>/<series>/<number>-<variant>.pdf', () => {
    expect(r2Key('2026-10-05', '300', 42, 'filed')).toBe('docs/2026/300/42-filed.pdf');
    expect(r2Key('2027-01-01', 'QT', 1, 'client')).toBe('docs/2027/QT/1-client.pdf');
  });
});

describe('loadRenderDocument', () => {
  it('builds a RenderDocument from a finalized document, its client and the business profile', async () => {
    const clientId = await insertClient();
    const draftId = await insertDocument(seriesId, { clientId });
    await finalizeDocument(db(), draftId, { actor: OWNER_ACTOR });

    const doc = await loadRenderDocument(db(), draftId, 'filed', { ownerTaxId: '123456782' });
    expect(doc.number).toBe(1);
    expect(doc.status).toBe('final');
    expect(doc.client?.nameEn).toBe('Test Client Ltd');
    expect(doc.business.taxId).toBe('123456782');
    expect(doc.isOriginal).toBe(true);
  });

  it('has no client when the document carries no client_id', async () => {
    const draftId = await insertDocument(seriesId);
    await finalizeDocument(db(), draftId, { actor: OWNER_ACTOR });
    const doc = await loadRenderDocument(db(), draftId, 'client', { ownerTaxId: null });
    expect(doc.client).toBeNull();
  });
});

describe('renderAndStore', () => {
  it('refuses to store a draft or a document with no number', async () => {
    const draftId = await insertDocument(seriesId);
    await expect(
      renderAndStore(db(), env.FILES, new FakePdfEngine(), draftId, 'filed', { ownerTaxId: null }),
    ).rejects.toThrow(/finaliz/);
  });

  it('stores the PDF bytes in R2 at docs/<year>/<series>/<number>-<variant>.pdf and records the SHA-256 hash', async () => {
    const clientId = await insertClient();
    const draftId = await insertDocument(seriesId, { clientId });
    const finalized = await finalizeDocument(db(), draftId, { actor: OWNER_ACTOR });

    const result = await renderAndStore(db(), env.FILES, new FakePdfEngine(), draftId, 'filed', { ownerTaxId: null });

    expect(result.key).toBe(`docs/2026/${seriesId}/${finalized.number}-filed.pdf`);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.sha256).toBe(await sha256Hex(result.bytes));

    const stored = await env.FILES.get(result.key);
    expect(stored).not.toBeNull();
    const storedText = await stored!.text();
    expect(storedText).toBe(result.html);

    const row = await db().prepare('SELECT pdf_hashes FROM documents WHERE id = ?').bind(draftId).first<{ pdf_hashes: string }>();
    const hashes = JSON.parse(row!.pdf_hashes) as { variant: string; sha256: string }[];
    expect(hashes).toHaveLength(1);
    expect(hashes[0]!.variant).toBe('filed');
    expect(hashes[0]!.sha256).toBe(result.sha256);
  });

  it('marks the second render of the same variant as a copy, not an original', async () => {
    const clientId = await insertClient();
    const draftId = await insertDocument(seriesId, { clientId });
    await finalizeDocument(db(), draftId, { actor: OWNER_ACTOR });

    const first = await renderAndStore(db(), env.FILES, new FakePdfEngine(), draftId, 'filed', { ownerTaxId: null });
    expect(first.html).toContain('מקור');
    expect(first.html).not.toContain('העתק');

    const second = await renderAndStore(db(), env.FILES, new FakePdfEngine(), draftId, 'filed', { ownerTaxId: null });
    expect(second.html).toContain('העתק');

    const row = await db().prepare('SELECT pdf_hashes FROM documents WHERE id = ?').bind(draftId).first<{ pdf_hashes: string }>();
    const hashes = JSON.parse(row!.pdf_hashes) as unknown[];
    expect(hashes).toHaveLength(2);
  });

  it('keeps the filed and client variants as separate hash entries', async () => {
    const clientId = await insertClient();
    const draftId = await insertDocument(seriesId, { clientId });
    await finalizeDocument(db(), draftId, { actor: OWNER_ACTOR });

    await renderAndStore(db(), env.FILES, new FakePdfEngine(), draftId, 'filed', { ownerTaxId: null });
    await renderAndStore(db(), env.FILES, new FakePdfEngine(), draftId, 'client', { ownerTaxId: null });

    const row = await db().prepare('SELECT pdf_hashes FROM documents WHERE id = ?').bind(draftId).first<{ pdf_hashes: string }>();
    const hashes = JSON.parse(row!.pdf_hashes) as { variant: string }[];
    expect(hashes.map((h) => h.variant).sort()).toEqual(['client', 'filed']);
  });

  it('refuses the client copy of a qualifying tax invoice with no allocation number (CLAUDE.md rule 3)', async () => {
    const clientId = await insertClient({ foreignResident: false });
    const draftId = await insertDocument(seriesId, { type: '305', clientId, subtotalMinor: 600000, vatAmountMinor: 108000 });
    await finalizeDocument(db(), draftId, { actor: OWNER_ACTOR });
    // R12 queued the allocation request and no number has come back yet (allocationGate: waiting_for_number).
    await run(db(), "INSERT INTO ita_allocations (document_id, invoice_id, environment, status) VALUES (?, ?, 'sandbox', 'pending')", draftId, crypto.randomUUID());

    await expect(
      renderAndStore(db(), env.FILES, new FakePdfEngine(), draftId, 'client', { ownerTaxId: null }),
    ).rejects.toThrow(/allocation/);

    // The filed copy, the internal audit record, is never blocked.
    await expect(
      renderAndStore(db(), env.FILES, new FakePdfEngine(), draftId, 'filed', { ownerTaxId: null }),
    ).resolves.toBeDefined();
  });

  it('allows the client copy once an allocation number is recorded', async () => {
    const clientId = await insertClient({ foreignResident: false });
    const draftId = await insertDocument(seriesId, {
      type: '305',
      clientId,
      subtotalMinor: 600000,
      vatAmountMinor: 108000,
      allocationNumber: '123456789',
    });
    await finalizeDocument(db(), draftId, { actor: OWNER_ACTOR });

    const result = await renderAndStore(db(), env.FILES, new FakePdfEngine(), draftId, 'client', { ownerTaxId: null });
    expect(result.html).toContain('123456789');
  });
});

/** R16 task 3: "Show document" on a draft, never stored, never signed, always stamped. */
describe('renderDraftPdf', () => {
  it('renders a draft with the diagonal DRAFT stamp and no stored copy', async () => {
    const clientId = await insertClient();
    const draftId = await insertDocument(seriesId, { clientId });

    const bytes = await renderDraftPdf(db(), new FakePdfEngine(), draftId, 'client', { ownerTaxId: null });
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('DRAFT, NOT A VALID DOCUMENT');
    expect(text).toContain('Draft, not yet issued');

    const row = await db().prepare('SELECT pdf_hashes FROM documents WHERE id = ?').bind(draftId).first<{ pdf_hashes: string | null }>();
    expect(row!.pdf_hashes).toBeNull();
    // The draft has no number, so it has no R2 key to check directly; pdf_hashes staying null
    // (nothing else writes it) is the proof that renderDraftPdf never called files.put.
  });

  it('refuses to preview a finalized document as a draft', async () => {
    const clientId = await insertClient();
    const draftId = await insertDocument(seriesId, { clientId });
    await finalizeDocument(db(), draftId, { actor: OWNER_ACTOR });

    await expect(renderDraftPdf(db(), new FakePdfEngine(), draftId, 'client', { ownerTaxId: null })).rejects.toThrow(/draft/i);
  });

  it('never carries a DRAFT stamp once the document is finalized', async () => {
    const clientId = await insertClient();
    const draftId = await insertDocument(seriesId, { clientId });
    await finalizeDocument(db(), draftId, { actor: OWNER_ACTOR });

    const doc = await loadRenderDocument(db(), draftId, 'client', { ownerTaxId: null });
    expect(renderDocument(doc, 'client')).not.toContain('class="draft-stamp"');
  });
});

describe('hasStoredPdf', () => {
  it('is false until renderAndStore stores that variant, then true', async () => {
    const clientId = await insertClient();
    const draftId = await insertDocument(seriesId, { clientId });
    await finalizeDocument(db(), draftId, { actor: OWNER_ACTOR });

    expect(await hasStoredPdf(db(), draftId, 'filed')).toBe(false);
    await renderAndStore(db(), env.FILES, new FakePdfEngine(), draftId, 'filed', { ownerTaxId: null });
    expect(await hasStoredPdf(db(), draftId, 'filed')).toBe(true);
    expect(await hasStoredPdf(db(), draftId, 'client')).toBe(false);
  });
});
