import { incomeReport } from './income';
import { expenseReport } from './expenses';

export interface ProfitLossMonth {
  month: string;
  incomeIlsMinor: number;
  expensesIlsMinor: number;
  netIlsMinor: number;
}

export interface ProfitLossReport {
  from: string;
  to: string;
  months: ProfitLossMonth[];
  incomeIlsMinor: number;
  expensesIlsMinor: number;
  netIlsMinor: number;
}

/** Income minus expenses, in ILS, by document date. Not a VAT report: that ships with R11's tax invoices. */
export async function profitLossReport(db: D1Database, from: string, to: string): Promise<ProfitLossReport> {
  const [income, expenses] = await Promise.all([incomeReport(db, from, to), expenseReport(db, from, to)]);

  const months = new Map<string, ProfitLossMonth>();
  for (const m of income.byMonth) {
    months.set(m.month, { month: m.month, incomeIlsMinor: m.totalIlsMinor, expensesIlsMinor: 0, netIlsMinor: m.totalIlsMinor });
  }
  for (const m of expenses.byMonth) {
    const row = months.get(m.month) ?? { month: m.month, incomeIlsMinor: 0, expensesIlsMinor: 0, netIlsMinor: 0 };
    row.expensesIlsMinor += m.totalIlsMinor;
    row.netIlsMinor = row.incomeIlsMinor - row.expensesIlsMinor;
    months.set(m.month, row);
  }

  return {
    from,
    to,
    months: [...months.values()].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0)),
    incomeIlsMinor: income.totalIlsMinor,
    expensesIlsMinor: expenses.totalIlsMinor,
    netIlsMinor: income.totalIlsMinor - expenses.totalIlsMinor,
  };
}
