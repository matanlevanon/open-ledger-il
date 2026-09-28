import { describe, expect, it } from 'vitest';
import { finalizeDocument } from '../../../src/core/numbering';
import { ceilingMeter, meterPercent } from '../../../src/modules/ceiling';
import { OWNER_ACTOR, db, makeDraft } from '../../helpers';

/** runs/R08-reports.md, "Tests": meter math with open requests. */
describe('ceilingMeter: turnover to date plus open payment requests', () => {
  it('reads the seeded 2026 ceiling with zero turnover on a fresh ledger', async () => {
    const meter = await ceilingMeter(db(), '2026-10-06');
    expect(meter).toEqual({
      year: 2026,
      currency: 'ILS',
      limitMinor: 12283300,
      turnoverMinor: 0,
      openRequestsMinor: 0,
      currentMinor: 0,
      legalMode: 'patur',
    });
  });

  it('adds a final receipt to turnover and an open payment request to open requests', async () => {
    const receipt = await makeDraft({ seriesId: '400', totalMinor: 100000 });
    await finalizeDocument(db(), receipt, { actor: OWNER_ACTOR });
    const request = await makeDraft({ seriesId: 'PR', totalMinor: 50000 });
    await finalizeDocument(db(), request, { actor: OWNER_ACTOR });

    const meter = await ceilingMeter(db(), '2026-10-06');
    expect(meter?.turnoverMinor).toBe(100000);
    expect(meter?.openRequestsMinor).toBe(50000);
    expect(meter?.currentMinor).toBe(150000);
  });

  it('closing an open request into a paid receipt moves the money from open to turnover, without double counting', async () => {
    const request = await makeDraft({ seriesId: '300', totalMinor: 20000 });
    await finalizeDocument(db(), request, { actor: OWNER_ACTOR });
    const before = await ceilingMeter(db(), '2026-10-06');

    const receipt = await makeDraft({ seriesId: '400', totalMinor: 20000 });
    await finalizeDocument(db(), receipt, { actor: OWNER_ACTOR });
    await db()
      .prepare(`INSERT INTO document_links (source_id, target_id, kind, amount_minor, currency) VALUES (?, ?, 'payment', 20000, 'ILS')`)
      .bind(request, receipt)
      .run();

    const after = await ceilingMeter(db(), '2026-10-06');
    expect(after!.currentMinor).toBe(before!.currentMinor); // 20,000 left open requests, 20,000 joined turnover
    expect(after!.openRequestsMinor).toBe(before!.openRequestsMinor - 20000);
    expect(after!.turnoverMinor).toBe(before!.turnoverMinor + 20000);
  });

  it('subtracts a credit receipt from turnover', async () => {
    const before = (await ceilingMeter(db(), '2026-10-06'))!.turnoverMinor;
    const credit = await makeDraft({ seriesId: '405', totalMinor: -40000 });
    await finalizeDocument(db(), credit, { actor: OWNER_ACTOR });
    const after = (await ceilingMeter(db(), '2026-10-06'))!.turnoverMinor;
    expect(after - before).toBe(-40000);
  });

  it('meterPercent reads the current amount against the limit', () => {
    expect(meterPercent({ currentMinor: 12283300, limitMinor: 12283300 })).toBe(100);
    expect(meterPercent({ currentMinor: 0, limitMinor: 12283300 })).toBe(0);
    expect(meterPercent({ currentMinor: 100, limitMinor: 0 })).toBe(0);
  });

  it('answers null for a year with no ceiling row', async () => {
    expect(await ceilingMeter(db(), '2099-01-01')).toBeNull();
  });

  /** R17 task 7: a document uploaded from another system counts toward the year's turnover too. */
  it('adds an uploaded external document to turnover', async () => {
    const before = (await ceilingMeter(db(), '2026-10-06'))!.turnoverMinor;
    await db()
      .prepare(
        `INSERT INTO external_documents (source, original_number, doc_type, issue_date, client_name_text, currency,
           amount_before_vat_minor, vat_amount_minor, total_minor, total_ils_minor, paid_status, r2_key, sha256)
         VALUES ('sumit', 'meter-test-1', 'Tax invoice', '2026-10-06', 'Old Client', 'ILS', 6000, 0, 6000, 6000, 'paid', 'k', 'h')`,
      )
      .run();
    const after = (await ceilingMeter(db(), '2026-10-06'))!.turnoverMinor;
    expect(after - before).toBe(6000);
  });
});
