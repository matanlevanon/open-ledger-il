import type { ReportResult } from '../reports';
import { dashboardFixture } from './dashboard';

/** VITE_MOCK=1 fixture for GET /api/reports/r/expenses-by-category, built from the dashboard fixture. */
export function expensesByCategoryFixture(): ReportResult {
  const card = dashboardFixture.cards.expenseCategories!;
  const rows = [...card.rows, ...(card.other ? [card.other] : [])];
  return {
    report: 'expenses-by-category',
    title: 'Expenses by category',
    from: card.from,
    to: card.to,
    columns: [
      { key: 'name', header: 'Category', kind: 'text' },
      { key: 'count', header: 'Expenses', kind: 'int', total: true },
      { key: 'original', header: 'Amount, original currency', kind: 'moneyList' },
      { key: 'ils', header: 'Amount ILS', kind: 'ils', total: true },
    ],
    rows: rows.map((r) => ({
      key: r.key,
      cells: { name: r.nameEn, count: r.count, original: r.byCurrency, ils: r.ilsMinor },
      link: { kind: 'report', report: 'expense-items', params: { categoryId: r.key.slice(9), from: card.from, to: card.to } },
    })),
    totals: { count: rows.reduce((s, r) => s + r.count, 0), ils: card.totalIlsMinor },
  };
}
