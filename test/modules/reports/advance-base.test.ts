import { describe, expect, it } from 'vitest';
import { finalizeDocument } from '../../../src/core/numbering';
import { advanceBaseReport } from '../../../src/modules/reports';
import { OWNER_ACTOR, db, makeDraft } from '../../helpers';

describe('advanceBaseReport: cash-basis payments received, by month (runs/R08-reports.md)', () => {
  it('sums payments on final documents in the period', async () => {
    const receipt = await makeDraft({
      seriesId: '400',
      totalMinor: 80000,
      payments: [{ amountMinor: 80000, paidOn: '2026-10-06' }],
    });
    await finalizeDocument(db(), receipt, { actor: OWNER_ACTOR });

    const report = await advanceBaseReport(db(), '2026-10-01', '2026-10-31');
    expect(report.months).toEqual([{ month: '2026-10', totalIlsMinor: 80000 }]);
    expect(report.totalIlsMinor).toBe(80000);
  });

  it('a credit receipt lowers the base for the month it lands in (negative payment, R01 decision)', async () => {
    const credit = await makeDraft({
      seriesId: '405',
      totalMinor: -30000,
      payments: [{ amountMinor: -30000, paidOn: '2026-10-06' }],
    });
    await finalizeDocument(db(), credit, { actor: OWNER_ACTOR });

    const report = await advanceBaseReport(db(), '2026-10-01', '2026-10-31');
    expect(report.months.find((m) => m.month === '2026-10')?.totalIlsMinor).toBe(80000 - 30000);
  });

  it('excludes a payment outside the requested range', async () => {
    const receipt = await makeDraft({
      seriesId: '400',
      totalMinor: 50000,
      payments: [{ amountMinor: 50000, paidOn: '2026-10-06' }],
    });
    await finalizeDocument(db(), receipt, { actor: OWNER_ACTOR });

    const report = await advanceBaseReport(db(), '2019-01-01', '2019-01-31');
    expect(report.months).toEqual([]);
    expect(report.totalIlsMinor).toBe(0);
  });
});
