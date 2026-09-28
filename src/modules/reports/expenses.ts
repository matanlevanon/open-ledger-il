import { all } from '../../core/db';

/**
 * Expenses by document date (runs/R08-reports.md: "expenses by month, category, supplier").
 * Counts `new` and `filed` only, the same rule R05's dashboard uses (`not_expense`, `duplicate`
 * and `returned` are not real spend). `expenses` is owned by R07 and always present once R07 is
 * merged, which this run's own header requires ("Needs R01 and R07 merged"), so no existence
 * check is needed here (unlike R05's dashboard, which had to run before R07 in the build order).
 */
const COUNTED_STATUS = "e.status IN ('new', 'filed')";

export interface ExpenseDetailRow {
  expenseId: number;
  date: string | null;
  currency: string;
  amountMinor: number;
  amountIlsMinor: number | null;
  supplierId: number | null;
  supplierName: string | null;
  categoryId: number | null;
  categoryName: string | null;
}

interface ExpenseSqlRow {
  id: number;
  document_date: string | null;
  currency: string;
  amount_minor: number;
  amount_ils_minor: number | null;
  supplier_id: number | null;
  supplier_name: string | null;
  category_id: number | null;
  category_name: string | null;
}

export async function expenseDetail(db: D1Database, from: string, to: string): Promise<ExpenseDetailRow[]> {
  const rows = await all<ExpenseSqlRow>(
    db,
    `SELECT e.id, e.document_date, e.currency, e.amount_minor, e.amount_ils_minor,
       s.id AS supplier_id, s.name AS supplier_name, c.id AS category_id, c.name_en AS category_name
     FROM expenses e
     LEFT JOIN suppliers s ON s.id = e.supplier_id
     LEFT JOIN expense_categories c ON c.id = e.category_id
     WHERE ${COUNTED_STATUS} AND e.document_date BETWEEN ? AND ?
     ORDER BY e.document_date, e.id`,
    from,
    to,
  );
  return rows.map((r) => ({
    expenseId: r.id,
    date: r.document_date,
    currency: r.currency,
    amountMinor: r.amount_minor,
    amountIlsMinor: r.amount_ils_minor,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    categoryId: r.category_id,
    categoryName: r.category_name,
  }));
}

export interface MonthTotal {
  month: string;
  totalIlsMinor: number;
}
export interface CategoryTotal {
  categoryId: number | null;
  categoryName: string | null;
  totalIlsMinor: number;
}
export interface SupplierTotal {
  supplierId: number | null;
  supplierName: string | null;
  totalIlsMinor: number;
}

export interface ExpenseReport {
  from: string;
  to: string;
  rows: ExpenseDetailRow[];
  byMonth: MonthTotal[];
  byCategory: CategoryTotal[];
  bySupplier: SupplierTotal[];
  totalIlsMinor: number;
}

function sortedValues<K, V>(map: Map<K, V>, key: (v: V) => string | number): V[] {
  return [...map.values()].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

export function summarizeExpenses(rows: ExpenseDetailRow[]): Omit<ExpenseReport, 'from' | 'to' | 'rows'> {
  const byMonth = new Map<string, MonthTotal>();
  const byCategory = new Map<string, CategoryTotal>();
  const bySupplier = new Map<string, SupplierTotal>();
  let totalIlsMinor = 0;

  for (const r of rows) {
    const ils = r.amountIlsMinor ?? 0;
    totalIlsMinor += ils;

    const month = (r.date ?? 'unknown').slice(0, 7);
    const m = byMonth.get(month) ?? { month, totalIlsMinor: 0 };
    m.totalIlsMinor += ils;
    byMonth.set(month, m);

    const catKey = String(r.categoryId ?? 'none');
    const cat = byCategory.get(catKey) ?? { categoryId: r.categoryId, categoryName: r.categoryName ?? 'Uncategorized', totalIlsMinor: 0 };
    cat.totalIlsMinor += ils;
    byCategory.set(catKey, cat);

    const supKey = String(r.supplierId ?? 'none');
    const sup = bySupplier.get(supKey) ?? { supplierId: r.supplierId, supplierName: r.supplierName ?? 'Unknown', totalIlsMinor: 0 };
    sup.totalIlsMinor += ils;
    bySupplier.set(supKey, sup);
  }

  return {
    byMonth: sortedValues(byMonth, (v) => v.month),
    byCategory: sortedValues(byCategory, (v) => v.categoryName ?? ''),
    bySupplier: sortedValues(bySupplier, (v) => v.supplierName ?? ''),
    totalIlsMinor,
  };
}

export async function expenseReport(db: D1Database, from: string, to: string): Promise<ExpenseReport> {
  const rows = await expenseDetail(db, from, to);
  return { from, to, rows, ...summarizeExpenses(rows) };
}

/** Files attached to counted expenses in the period, for the accountant pack ZIP. */
export interface ExpenseFileForPeriod {
  r2Key: string;
  filename: string;
}

export async function expenseFilesForPeriod(db: D1Database, from: string, to: string): Promise<ExpenseFileForPeriod[]> {
  const rows = await all<{ r2_key: string; filename: string }>(
    db,
    `SELECT f.r2_key, f.filename
     FROM expenses e JOIN expense_files f ON f.id = e.file_id
     WHERE ${COUNTED_STATUS} AND e.document_date BETWEEN ? AND ?
     ORDER BY e.document_date, e.id`,
    from,
    to,
  );
  return rows.map((r) => ({ r2Key: r.r2_key, filename: r.filename }));
}
