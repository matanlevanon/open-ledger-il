import { beforeAll, describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import {
  agingBucket,
  cashFlowByMonth,
  expensesByCategory,
  foldBreakdown,
  incomeByClient,
  incomeByMonth,
  incomeByService,
  monthsBetween,
  openItems,
  profitLossByMonth,
  sameDayLastYear,
  yearComparison,
} from '../../../src/modules/reports/aggregates';
import { incomeReport } from '../../../src/modules/reports';
import { turnoverIls } from '../../../src/modules/dashboard';
import { db } from '../../helpers';
import { issue, line, makeClient, ok, pay } from '../../documents/helpers';

/**
 * R21 aggregates against fixtures that go through the real documents API (so credits carry the
 * negative totals the API stores): ILS and USD receipts, a credit, a cancelled receipt, imported
 * SUMIT and Wave documents, and expenses with and without a category. Final documents never
 * disappear, so month totals are read as deltas against a baseline taken before the fixtures.
 */

const FROM = '2026-10-01';
const TO = '2026-10-31';
const MONTH = '2026-10';

let ilsClient: number;
let usdClient: number;
let usdIls: number;
let categoryId: number;
let baseline: { income: number; imported: number; cashIn: number; cashImported: number; out: number; expenses: number; turnover: number };

async function monthIncome() {
  return (await incomeByMonth(db(), FROM, TO)).find((m) => m.month === MONTH)!;
}

beforeAll(async () => {
  const income = await monthIncome();
  const cash = (await cashFlowByMonth(db(), FROM, TO)).find((m) => m.month === MONTH)!;
  const pl = (await profitLossByMonth(db(), FROM, TO)).find((m) => m.month === MONTH)!;
  baseline = {
    income: income.issuedIlsMinor,
    imported: income.importedIlsMinor,
    cashIn: cash.inflowIlsMinor,
    cashImported: cash.importedInflowIlsMinor,
    out: cash.outflowIlsMinor,
    expenses: pl.expensesIlsMinor,
    turnover: await turnoverIls(db(), '2026-01-01', '2026-12-31'),
  };

  ilsClient = await makeClient({ nameEn: 'R21 ILS Client' });
  usdClient = await makeClient({ nameEn: 'R21 USD Client', currency: 'USD' });

  // ILS receipt 1,000.00 with a service line, then a partial credit of 200.00.
  const ilsReceipt = await issue('400', { clientId: ilsClient, lines: [line(100000, 'R21 Retainer')], payments: [pay(100000)] });
  await ok('POST', `/documents/${ilsReceipt.document.id}/credit`, { mode: 'partial', amountMinor: 20000, reason: 'Scope cut' });

  // USD receipt $500.00 at the BOI rate on the receipt date.
  const usdReceipt = await issue('400', { clientId: usdClient, lines: [line(50000, 'R21 Workshop')], payments: [pay(50000)] });
  usdIls = usdReceipt.document.total_ils_minor as number;

  // A cancelled receipt never counts.
  const cancelled = await issue('400', { clientId: ilsClient, payments: [pay(33300)] });
  await ok('POST', `/documents/${cancelled.document.id}/cancel`, { reason: 'Wrong amount' });

  // Imported: one paid SUMIT document for the ILS client, one unpaid Wave document with no matched client.
  await run(
    db(),
    `INSERT INTO external_documents (source, original_number, doc_type, issue_date, client_id, client_name_text, currency,
       amount_before_vat_minor, vat_amount_minor, total_minor, total_ils_minor, paid_status, r2_key, sha256)
     VALUES ('sumit', 'r21-1', 'Receipt', '2026-10-02', ?, 'R21 ILS Client', 'ILS', 5000, 0, 5000, 5000, 'paid', 'k1', 'h1'),
            ('wave', 'r21-2', 'Invoice', '2026-10-03', NULL, 'R21 Old Wave Client', 'USD', 1000, 0, 1000, 3700, 'unpaid', 'k2', 'h2')`,
    ilsClient,
  );

  // Expenses: one with a category, one without, one duplicate that never counts.
  const cat = await run(db(), `INSERT INTO expense_categories (key, name_en) VALUES ('r21-software', 'R21 Software')`);
  categoryId = cat.lastRowId;
  await run(
    db(),
    `INSERT INTO expenses (category_id, status, document_date, currency, amount_minor, amount_ils_minor, is_fixed) VALUES
       (?, 'filed', '2026-10-04', 'ILS', 20000, 20000, 1),
       (NULL, 'new', '2026-10-05', 'USD', 1000, 3700, 0),
       (NULL, 'duplicate', '2026-10-05', 'ILS', 99999, 99999, NULL)`,
    categoryId,
  );
});

describe('R21 aggregates', () => {
  it('income by month nets a credit, converts USD at the stored rate, and skips cancelled documents', async () => {
    const m = await monthIncome();
    expect(m.issuedIlsMinor - baseline.income).toBe(100000 - 20000 + usdIls);
  });

  it('a real credit lowers turnover for the ceiling (credits reduce income)', async () => {
    const after = await turnoverIls(db(), '2026-01-01', '2026-12-31');
    expect(after - baseline.turnover).toBe(80000 + usdIls);
  });

  it('the R08 income report agrees: credits reduce income once', async () => {
    const report = await incomeReport(db(), FROM, TO);
    const ils = report.byClient.find((c) => c.clientName === 'R21 ILS Client');
    expect(ils?.totalIlsMinor).toBe(80000 + 5000);
  });

  it('counts imported documents as income, marked imported', async () => {
    const m = await monthIncome();
    expect(m.importedIlsMinor - baseline.imported).toBe(5000 + 3700);
    expect(m.totalIlsMinor).toBe(m.issuedIlsMinor + m.importedIlsMinor);
  });

  it('income by client merges issued and imported, keeps the original currency, and groups an unmatched import by name', async () => {
    const b = await incomeByClient(db(), FROM, TO);
    const ils = b.rows.find((r) => r.key === `client:${ilsClient}`)!;
    expect(ils.ilsMinor).toBe(85000);
    expect(ils.imported).toBe(false);
    const usd = b.rows.find((r) => r.key === `client:${usdClient}`)!;
    expect(usd.byCurrency).toEqual({ USD: 50000 });
    expect(usd.ilsMinor).toBe(usdIls);
    const old = b.rows.find((r) => r.key === 'name:R21 Old Wave Client')!;
    expect(old).toMatchObject({ ilsMinor: 3700, imported: true, byCurrency: { USD: 1000 } });
  });

  it('income by service reads document lines in ILS and counts quantity', async () => {
    const b = await incomeByService(db(), FROM, TO);
    const workshop = b.rows.find((r) => r.nameEn === 'R21 Workshop')!;
    expect(workshop.ilsMinor).toBe(usdIls);
    expect(workshop.byCurrency).toEqual({ USD: 50000 });
    expect(workshop.quantityMilli).toBe(1000);
  });

  it('cash flow counts payments in, paid imports, and expenses out below zero', async () => {
    const m = (await cashFlowByMonth(db(), FROM, TO)).find((x) => x.month === MONTH)!;
    // The credit refunds 200.00, the cancelled receipt's payment does not count.
    expect(m.inflowIlsMinor - baseline.cashIn).toBe(100000 - 20000 + usdIls);
    expect(m.importedInflowIlsMinor - baseline.cashImported).toBe(5000);
    expect(m.outflowIlsMinor - baseline.out).toBe(-(20000 + 3700));
    expect(m.netIlsMinor).toBe(m.inflowIlsMinor + m.importedInflowIlsMinor + m.outflowIlsMinor);
  });

  it('expenses by category counts new and filed, labels no category Uncategorized, and skips duplicates', async () => {
    const b = await expensesByCategory(db(), FROM, TO);
    expect(b.rows.find((r) => r.key === `category:${categoryId}`)?.ilsMinor).toBe(20000);
    expect(b.rows.find((r) => r.key === 'category:none')?.nameEn).toBe('Uncategorized');
    const pl = (await profitLossByMonth(db(), FROM, TO)).find((m) => m.month === MONTH)!;
    expect(pl.expensesIlsMinor - baseline.expenses).toBe(23700);
  });

  it('year comparison splits the previous year, the same period last year and this year to date', async () => {
    const y = await yearComparison(db(), '2026-10-31');
    expect(y.previousYear).toMatchObject({ from: '2025-01-01', to: '2025-12-31' });
    expect(y.samePeriodLastYear).toMatchObject({ from: '2025-01-01', to: '2025-10-31' });
    expect(y.yearToDate.from).toBe('2026-01-01');
    expect(y.yearToDate.incomeIlsMinor).toBeGreaterThanOrEqual(80000 + usdIls + 8700);
    expect(y.yearToDate.netIlsMinor).toBe(y.yearToDate.incomeIlsMinor - y.yearToDate.expensesIlsMinor);
  });

  it('open items age a payment request past its due date into the right bucket', async () => {
    const pr = await issue('PR', { clientId: usdClient, lines: [line(10000)], dueDate: '2026-10-06' });
    const items = await openItems(db(), '2026-11-20');
    const item = items.find((i) => i.documentId === pr.document.id)!;
    expect(item).toMatchObject({ currency: 'USD', remainingMinor: 10000, daysOverdue: 45, bucket: '31-60', clientNameEn: 'R21 USD Client' });
  });
});

describe('R21 aggregate helpers', () => {
  it('folds everything past the top rows into Other', () => {
    const rows = [1, 2, 3, 4].map((n) => ({ key: `k${n}`, nameEn: `n${n}`, nameHe: `n${n}`, ilsMinor: n * 100, byCurrency: { ILS: n * 100 }, count: 1 }));
    const b = foldBreakdown(rows, 2);
    expect(b.rows.map((r) => r.key)).toEqual(['k4', 'k3']);
    expect(b.other).toMatchObject({ key: 'other', ilsMinor: 300, count: 2, byCurrency: { ILS: 300 } });
    expect(b.totalIlsMinor).toBe(1000);
  });

  it('buckets days past due', () => {
    expect([-3, 0, 1, 30, 31, 60, 61, 90, 91].map(agingBucket)).toEqual(['current', 'current', '1-30', '1-30', '31-60', '31-60', '61-90', '61-90', '90+']);
  });

  it('lists every month of a range and maps 29 February back a year', () => {
    expect(monthsBetween('2025-11-15', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(sameDayLastYear('2028-02-29')).toBe('2027-02-28');
  });
});
