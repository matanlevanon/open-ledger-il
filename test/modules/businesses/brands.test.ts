import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { first, run } from '../../../src/core/db';
import { loadRenderDocument } from '../../../src/modules/pdf/store';
import { renderDocument } from '../../../src/modules/pdf/render';
import { db, makeDraft, makeSeries, sqlError } from '../../helpers';

/**
 * R24 Phase B (R23 task 4): a brand is printed in the document header. Empty brand fields print the
 * business's own. The tax id and legal name always come from the business. The brand is frozen
 * once the document is final, like every other column.
 */
describe('brands on documents', () => {
  it('the default brand starts empty, so the header prints the business as before', async () => {
    await run(db(), "UPDATE business_profile SET name_en = 'Sample Business', tax_id = '123456782' WHERE id = 1");
    const id = await makeDraft({ seriesId: await makeSeries() });
    const doc = await loadRenderDocument(db(), id, 'client', { ownerTaxId: null });
    expect(doc.business.nameEn).toBe('Sample Business');
    expect(renderDocument(doc, 'client')).not.toContain('Sample Business, ');
  });

  it('a brand prints its name, with the legal name next to the tax id', async () => {
    const { lastRowId: brandId } = await run(db(), "INSERT INTO brands (business_id, name_en, tagline_en) VALUES (1, 'Studio Brand', 'Design work')");
    const id = await makeDraft({ seriesId: await makeSeries() });
    await run(db(), 'UPDATE documents SET brand_id = ? WHERE id = ?', brandId, id);
    const doc = await loadRenderDocument(db(), id, 'client', { ownerTaxId: null });
    expect(doc.business.nameEn).toBe('Studio Brand');
    expect(doc.business.taglineEn).toBe('Design work');
    expect(doc.business.taxId).toBe('123456782');
    const html = renderDocument(doc, 'client');
    expect(html).toContain('Studio Brand');
    expect(html).toContain('Sample Business, ');
  });

  it('a brand of another business is refused, and a brand is never deleted (raw SQL)', async () => {
    await run(env.DB, "INSERT OR IGNORE INTO businesses (id, name_en, name_he, entity_type) VALUES (3, 'Other', 'אחר', 'company')");
    const { lastRowId: other } = await run(db(), "INSERT INTO brands (business_id, name_en) VALUES (3, 'Other Brand')");
    const id = await makeDraft({ seriesId: await makeSeries() });
    expect(await sqlError('UPDATE documents SET brand_id = ? WHERE id = ?', other, id)).toContain('business_mismatch');
    expect(await sqlError('DELETE FROM brands WHERE id = ?', other)).toContain('brand_in_use');
    expect((await first<{ n: number }>(db(), 'SELECT COUNT(*) AS n FROM brands WHERE business_id = 1 AND is_default = 1'))?.n).toBe(1);
  });
});
