import { describe, expect, it } from 'vitest';
import { finalizeDocument } from '../../../src/core/numbering';
import { profitLossReport } from '../../../src/modules/reports';
import { OWNER_ACTOR, db, makeDraft } from '../../helpers';

describe('profitLossReport: income minus expenses by month (runs/R08-reports.md)', () => {
  it('nets income against expenses for the same month', async () => {
    const receipt = await makeDraft({ seriesId: '400', totalMinor: 100000 });
    await finalizeDocument(db(), receipt, { actor: OWNER_ACTOR });
    await db()
      .prepare(`INSERT INTO expenses (status, document_date, currency, amount_minor, amount_ils_minor) VALUES ('filed', '2026-10-15', 'ILS', 30000, 30000)`)
      .run();

    const report = await profitLossReport(db(), '2026-10-01', '2026-10-31');
    const month = report.months.find((m) => m.month === '2026-10');
    expect(month).toEqual({ month: '2026-10', incomeIlsMinor: 100000, expensesIlsMinor: 30000, netIlsMinor: 70000 });
    expect(report.incomeIlsMinor).toBe(100000);
    expect(report.expensesIlsMinor).toBe(30000);
    expect(report.netIlsMinor).toBe(70000);
  });

  it('reports a month with expenses only as a negative net', async () => {
    await db()
      .prepare(`INSERT INTO expenses (status, document_date, currency, amount_minor, amount_ils_minor) VALUES ('filed', '2020-03-10', 'ILS', 15000, 15000)`)
      .run();
    const report = await profitLossReport(db(), '2020-03-01', '2020-03-31');
    expect(report.months).toEqual([{ month: '2020-03', incomeIlsMinor: 0, expensesIlsMinor: 15000, netIlsMinor: -15000 }]);
  });
});
