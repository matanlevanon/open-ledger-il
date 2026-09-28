import { exports, env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { finalizeDocument } from '../../src/core/numbering';
import { FakePdfEngine } from '../../src/modules/pdf/engine';
import { renderAndStore } from '../../src/modules/pdf/store';
import { insertClient, insertDocument } from '../fixtures/pdf/db';
import { OWNER_ACTOR, db, makeSeries } from '../helpers';

async function get(path: string, headers: Record<string, string> = {}) {
  return exports.default.fetch(`https://ledger.test${path}`, { headers });
}

async function post(path: string, headers: Record<string, string> = {}) {
  return exports.default.fetch(`https://ledger.test${path}`, { method: 'POST', headers });
}

let seriesId: string;

beforeEach(async () => {
  seriesId = await makeSeries();
});

describe('GET /api/pdf/documents/:id', () => {
  it('renders the client copy as HTML, signed in through the dev bypass', async () => {
    const clientId = await insertClient();
    const draftId = await insertDocument(seriesId, { clientId });
    const finalized = await finalizeDocument(db(), draftId, { actor: OWNER_ACTOR });

    const res = await get(`/api/pdf/documents/${draftId}?variant=client`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain(`#${finalized.number}`);
    expect(html).not.toContain('class="section he-block"');
  });

  it('renders the filed copy bilingually', async () => {
    const draftId = await insertDocument(seriesId);
    await finalizeDocument(db(), draftId, { actor: OWNER_ACTOR });

    const res = await get(`/api/pdf/documents/${draftId}?variant=filed`);
    const html = await res.text();
    expect(html).toContain('class="section en-block bilingual-block"');
    expect(html).toContain('dir="rtl" lang="he"');
  });

  it('previews a draft with no number yet', async () => {
    const draftId = await insertDocument(seriesId);
    const res = await get(`/api/pdf/documents/${draftId}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Draft, not yet issued');
  });

  it('answers 404 for a document that does not exist', async () => {
    const res = await get('/api/pdf/documents/999999');
    expect(res.status).toBe(404);
  });

  it('answers 400 for a bad variant', async () => {
    const draftId = await insertDocument(seriesId);
    const res = await get(`/api/pdf/documents/${draftId}?variant=bogus`);
    expect(res.status).toBe(400);
  });
});

/** R16 task 3: "Show document" opens a real PDF for a draft, never stored, never signed. */
describe('GET /api/pdf/documents/:id/draft.pdf', () => {
  it('refuses to preview a finalized document as a draft', async () => {
    const draftId = await insertDocument(seriesId);
    await finalizeDocument(db(), draftId, { actor: OWNER_ACTOR });
    const res = await get(`/api/pdf/documents/${draftId}/draft.pdf`);
    expect(res.status).toBe(400);
  });

  it('answers 404 for a document that does not exist', async () => {
    const res = await get('/api/pdf/documents/999999/draft.pdf');
    expect(res.status).toBe(404);
  });
});

/** R16 task 4: "View client copy" / "View filed copy" on a finalized document. */
describe('POST /api/pdf/documents/:id/view', () => {
  it('refuses to view an unfinalized draft', async () => {
    const draftId = await insertDocument(seriesId);
    const res = await post(`/api/pdf/documents/${draftId}/view?variant=filed`);
    expect(res.status).toBe(400);
  });

  it('reuses an already-stored copy on a later view, with no Browser Rendering call needed', async () => {
    const clientId = await insertClient();
    const draftId = await insertDocument(seriesId, { clientId });
    await finalizeDocument(db(), draftId, { actor: OWNER_ACTOR });
    // Pre-store the filed copy directly, the way the first "View filed copy" click would.
    await renderAndStore(db(), env.FILES, new FakePdfEngine(), draftId, 'filed', { ownerTaxId: null });

    const res = await post(`/api/pdf/documents/${draftId}/view?variant=filed`);
    expect(res.status).toBe(200);
    const body = await res.json<{ url: string; expiresAt: string }>();
    expect(body.url).toMatch(/^\/access\/downloads\//);

    const download = await get(`/api${body.url}`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('application/pdf');
  });

  /** R17 task 3: opens inline, same as the draft preview, not a forced download. */
  it('signs the link to open inline in a new tab', async () => {
    const draftId = await insertDocument(seriesId);
    await finalizeDocument(db(), draftId, { actor: OWNER_ACTOR });
    await renderAndStore(db(), env.FILES, new FakePdfEngine(), draftId, 'client', { ownerTaxId: null });

    const res = await post(`/api/pdf/documents/${draftId}/view?variant=client`);
    const body = await res.json<{ url: string }>();
    const opened = await get(`/api${body.url}`);
    expect(opened.headers.get('content-disposition')).toMatch(/^inline;/);
  });
});

/** R17 task 3: a separate "Download" button next to each view button. */
describe('POST /api/pdf/documents/:id/download', () => {
  it('refuses to download an unfinalized draft', async () => {
    const draftId = await insertDocument(seriesId);
    const res = await post(`/api/pdf/documents/${draftId}/download?variant=filed`);
    expect(res.status).toBe(400);
  });

  it('signs a link that saves as "<type>-<number>-<client>.pdf"', async () => {
    const clientId = await insertClient();
    const draftId = await insertDocument(seriesId, { clientId });
    const finalized = await finalizeDocument(db(), draftId, { actor: OWNER_ACTOR });
    await renderAndStore(db(), env.FILES, new FakePdfEngine(), draftId, 'client', { ownerTaxId: null });

    const res = await post(`/api/pdf/documents/${draftId}/download?variant=client`);
    expect(res.status).toBe(200);
    const body = await res.json<{ url: string; expiresAt: string }>();

    const download = await get(`/api${body.url}`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toBe(
      `attachment; filename="${seriesId}-${String(finalized.number).padStart(4, '0')}-Test-Client-Ltd.pdf"`,
    );
  });
});
