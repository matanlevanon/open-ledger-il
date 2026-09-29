import { all, first } from '../../core/db';
import { HOME_CURRENCY, assertCurrency, convert } from '../../core/money';
import { type OpenDemand, openDemands, openImportedDemands } from '../documents/balances';
import { displayNumber } from '../documents/types';
import { FxUnavailableError, rateOn } from '../fx';
import { externalIsCashSql, externalIsIncomeSql, externalSignSql } from '../import/external-kind';

/**
 * R21 aggregates for the dashboard cards and the reports list. Every figure is summed in SQL,
 * one query per card, in ILS (the ILS amount the ledger stored at the Bank of Israel rate).
 *
 * Income is every final income document (receipts, invoices and their credits, which are stored
 * with negative totals, so a plain SUM nets them) plus every document uploaded from SUMIT or Wave
 * (`external_documents`), flagged `imported` so history before go-live shows and stays marked.
 * Only imported receipts, invoices and credits count. An imported quote, payment request or pro
 * forma is paid by a receipt, and counting both would count the same money twice.
 * Cancelled documents never count: only `status = 'final'` is read.
 * Expenses count when `new` or `filed`, the same rule as the expenses report.
 */

const INCOME_KINDS = "'receipt', 'credit', 'invoice', 'invoice_receipt', 'credit_invoice'";

/** The ILS figure for a row: the stored conversion, or the amount itself when it is ILS. */
const ILS = (amount: string, currency: string, ils: string) => `COALESCE(${ils}, CASE WHEN ${currency} = 'ILS' THEN ${amount} END)`;

/**
 * Income rows in a date range. Binds four parameters: from, to, from, to.
 * Columns: date, client_id, name_en, name_he, name_text, currency, amount_minor, ils_minor, imported.
 */
export const INCOME_ROWS_SQL = `
  SELECT d.date AS date, d.client_id AS client_id, c.name_en AS name_en, c.name_he AS name_he, NULL AS name_text,
    d.currency AS currency, d.total_minor AS amount_minor, ${ILS('d.total_minor', 'd.currency', 'd.total_ils_minor')} AS ils_minor,
    0 AS imported
  FROM documents d JOIN document_types dt ON dt.code = d.type LEFT JOIN clients c ON c.id = d.client_id
  WHERE d.status = 'final' AND dt.kind IN (${INCOME_KINDS}) AND d.date BETWEEN ? AND ?
  UNION ALL
  SELECT x.issue_date, x.client_id, c.name_en, c.name_he, x.client_name_text,
    x.currency, ${externalSignSql('x.doc_type')} * x.total_minor, ${externalSignSql('x.doc_type')} * ${ILS('x.total_minor', 'x.currency', 'x.total_ils_minor')}, 1
  FROM external_documents x LEFT JOIN clients c ON c.id = x.client_id
  WHERE x.issue_date BETWEEN ? AND ? AND ${externalIsIncomeSql('x.doc_type')}`;

/** Counted expenses in a date range. Binds two parameters: from, to. */
export const EXPENSE_ROWS_SQL = `
  SELECT e.id AS id, e.document_date AS date, e.currency AS currency, e.amount_minor AS amount_minor,
    ${ILS('e.amount_minor', 'e.currency', 'e.amount_ils_minor')} AS ils_minor,
    e.category_id AS category_id, cat.name_en AS category_name, e.supplier_id AS supplier_id, s.name AS supplier_name,
    e.is_fixed AS is_fixed
  FROM expenses e
  LEFT JOIN expense_categories cat ON cat.id = e.category_id
  LEFT JOIN suppliers s ON s.id = e.supplier_id
  WHERE e.status IN ('new', 'filed') AND e.document_date BETWEEN ? AND ?`;

/** Every YYYY-MM from `from`'s month to `to`'s month, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  const out: string[] = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? ((m = 1), (y += 1)) : (m += 1)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (out.length > 600) break;
  }
  return out;
}

type Money = Record<string, number>;

function addMoney(target: Money, currency: string, amount: number) {
  target[currency] = (target[currency] ?? 0) + amount;
}

// ---------------------------------------------------------------------------
// Monthly series
// ---------------------------------------------------------------------------

export interface CashFlowMonth {
  month: string;
  /** Payments received on Open Ledger IL receipts. Refunds on a credit are negative. */
  inflowIlsMinor: number;
  /** Imported receipts (less imported credits), counted on their issue date. */
  importedInflowIlsMinor: number;
  /** Expenses, as a negative number so the bar sits below zero. */
  outflowIlsMinor: number;
  netIlsMinor: number;
}

/** Cash flow: money in from payments (and paid imported documents), money out on expenses. */
export async function cashFlowByMonth(db: D1Database, from: string, to: string): Promise<CashFlowMonth[]> {
  const rows = await all<{ month: string; kind: string; total: number | null }>(
    db,
    `SELECT month, kind, SUM(ils) AS total FROM (
       SELECT strftime('%Y-%m', p.paid_on) AS month, 'in' AS kind, ${ILS('p.amount_minor', 'p.currency', 'p.amount_ils_minor')} AS ils
       FROM payments p JOIN documents d ON d.id = p.document_id
       WHERE d.status = 'final' AND p.paid_on BETWEEN ? AND ?
       UNION ALL
       SELECT strftime('%Y-%m', x.issue_date), 'imported', ${externalSignSql('x.doc_type')} * ${ILS('x.total_minor', 'x.currency', 'x.total_ils_minor')}
       FROM external_documents x WHERE ${externalIsCashSql('x.doc_type')} AND x.issue_date BETWEEN ? AND ?
       UNION ALL
       SELECT strftime('%Y-%m', e.document_date), 'out', ${ILS('e.amount_minor', 'e.currency', 'e.amount_ils_minor')}
       FROM expenses e WHERE e.status IN ('new', 'filed') AND e.document_date BETWEEN ? AND ?
     ) GROUP BY month, kind`,
    from,
    to,
    from,
    to,
    from,
    to,
  );
  const byMonth = new Map<string, CashFlowMonth>(
    monthsBetween(from, to).map((month) => [month, { month, inflowIlsMinor: 0, importedInflowIlsMinor: 0, outflowIlsMinor: 0, netIlsMinor: 0 }]),
  );
  for (const r of rows) {
    const m = byMonth.get(r.month);
    if (!m) continue;
    const v = r.total ?? 0;
    if (r.kind === 'in') m.inflowIlsMinor += v;
    else if (r.kind === 'imported') m.importedInflowIlsMinor += v;
    else m.outflowIlsMinor -= v;
  }
  for (const m of byMonth.values()) m.netIlsMinor = m.inflowIlsMinor + m.importedInflowIlsMinor + m.outflowIlsMinor;
  return [...byMonth.values()];
}

export interface ProfitLossMonthAgg {
  month: string;
  incomeIlsMinor: number;
  importedIncomeIlsMinor: number;
  expensesIlsMinor: number;
  netIlsMinor: number;
}

/** Income (issued plus imported) against expenses, by document date. */
export async function profitLossByMonth(db: D1Database, from: string, to: string): Promise<ProfitLossMonthAgg[]> {
  const rows = await all<{ month: string; kind: string; total: number | null }>(
    db,
    `SELECT month, kind, SUM(ils) AS total FROM (
       SELECT strftime('%Y-%m', date) AS month, CASE WHEN imported = 1 THEN 'imported' ELSE 'income' END AS kind, ils_minor AS ils
       FROM (${INCOME_ROWS_SQL})
       UNION ALL
       SELECT strftime('%Y-%m', date), 'expense', ils_minor FROM (${EXPENSE_ROWS_SQL})
     ) GROUP BY month, kind`,
    from,
    to,
    from,
    to,
    from,
    to,
  );
  const byMonth = new Map<string, ProfitLossMonthAgg>(
    monthsBetween(from, to).map((month) => [month, { month, incomeIlsMinor: 0, importedIncomeIlsMinor: 0, expensesIlsMinor: 0, netIlsMinor: 0 }]),
  );
  for (const r of rows) {
    const m = byMonth.get(r.month);
    if (!m) continue;
    const v = r.total ?? 0;
    if (r.kind === 'income') m.incomeIlsMinor += v;
    else if (r.kind === 'imported') m.importedIncomeIlsMinor += v;
    else m.expensesIlsMinor += v;
  }
  for (const m of byMonth.values()) m.netIlsMinor = m.incomeIlsMinor + m.importedIncomeIlsMinor - m.expensesIlsMinor;
  return [...byMonth.values()];
}

export interface IncomeMonth {
  month: string;
  issuedIlsMinor: number;
  importedIlsMinor: number;
  totalIlsMinor: number;
}

/** Income by month, SUMIT's "income without VAT by month" (a פטור charges no VAT, so total is net). */
export async function incomeByMonth(db: D1Database, from: string, to: string): Promise<IncomeMonth[]> {
  const rows = await all<{ month: string; imported: number; total: number | null }>(
    db,
    `SELECT strftime('%Y-%m', date) AS month, imported, SUM(ils_minor) AS total FROM (${INCOME_ROWS_SQL}) GROUP BY month, imported`,
    from,
    to,
    from,
    to,
  );
  const byMonth = new Map<string, IncomeMonth>(
    monthsBetween(from, to).map((month) => [month, { month, issuedIlsMinor: 0, importedIlsMinor: 0, totalIlsMinor: 0 }]),
  );
  for (const r of rows) {
    const m = byMonth.get(r.month);
    if (!m) continue;
    if (r.imported === 1) m.importedIlsMinor += r.total ?? 0;
    else m.issuedIlsMinor += r.total ?? 0;
    m.totalIlsMinor = m.issuedIlsMinor + m.importedIlsMinor;
  }
  return [...byMonth.values()];
}

// ---------------------------------------------------------------------------
// Breakdowns
// ---------------------------------------------------------------------------

export interface ShareRow {
  /** Stable key for compare and drill-down: `client:<id>`, `name:<text>`, `item:<id>`, `line:<text>`, `category:<id|none>`. */
  key: string;
  nameEn: string;
  nameHe: string;
  ilsMinor: number;
  /** Original-currency amounts, for tooltips and tables. */
  byCurrency: Money;
  count: number;
  /** Set when every amount in the row came from an imported document. */
  imported?: boolean;
  quantityMilli?: number;
}

export interface Breakdown {
  rows: ShareRow[];
  /** Everything past the top `limit`, folded into one "Other" row. Null when nothing is left over. */
  other: ShareRow | null;
  totalIlsMinor: number;
}

/** Sorts by ILS, keeps the top `limit`, folds the rest into Other. */
export function foldBreakdown(rows: ShareRow[], limit?: number): Breakdown {
  const sorted = [...rows].sort((a, b) => b.ilsMinor - a.ilsMinor || a.nameEn.localeCompare(b.nameEn));
  const totalIlsMinor = sorted.reduce((s, r) => s + r.ilsMinor, 0);
  if (limit === undefined || sorted.length <= limit) return { rows: sorted, other: null, totalIlsMinor };
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  const other: ShareRow = { key: 'other', nameEn: 'Other', nameHe: 'אחר', ilsMinor: 0, byCurrency: {}, count: 0 };
  for (const r of rest) {
    other.ilsMinor += r.ilsMinor;
    other.count += r.count;
    for (const [c, v] of Object.entries(r.byCurrency)) addMoney(other.byCurrency, c, v);
  }
  return { rows: top, other, totalIlsMinor };
}

function mergeShareRow(map: Map<string, ShareRow>, key: string, init: () => ShareRow, currency: string, amount: number, ils: number | null, count: number, imported: boolean) {
  const row = map.get(key) ?? init();
  row.ilsMinor += ils ?? 0;
  row.count += count;
  addMoney(row.byCurrency, currency, amount);
  row.imported = (map.has(key) ? row.imported : true) && imported;
  map.set(key, row);
}

/** Income per client, issued and imported. An imported document with no matched client groups by its printed name. */
export async function incomeByClient(db: D1Database, from: string, to: string, limit?: number): Promise<Breakdown> {
  const rows = await all<{
    client_id: number | null;
    name_en: string | null;
    name_he: string | null;
    name_text: string | null;
    currency: string;
    imported: number;
    amount: number;
    ils: number | null;
    n: number;
  }>(
    db,
    `SELECT client_id, name_en, name_he, name_text, currency, imported, SUM(amount_minor) AS amount, SUM(ils_minor) AS ils, COUNT(*) AS n
     FROM (${INCOME_ROWS_SQL})
     GROUP BY client_id, CASE WHEN client_id IS NULL THEN name_text END, currency, imported`,
    from,
    to,
    from,
    to,
  );
  const map = new Map<string, ShareRow>();
  for (const r of rows) {
    const key = r.client_id !== null ? `client:${r.client_id}` : `name:${r.name_text ?? ''}`;
    const en = (r.name_en ?? '').trim() || (r.name_he ?? '').trim() || (r.name_text ?? '');
    const he = (r.name_he ?? '').trim() || (r.name_en ?? '').trim() || (r.name_text ?? '');
    mergeShareRow(map, key, () => ({ key, nameEn: en, nameHe: he, ilsMinor: 0, byCurrency: {}, count: 0 }), r.currency, r.amount, r.ils, r.n, r.imported === 1);
  }
  return foldBreakdown([...map.values()], limit);
}

/**
 * Income per service, from the lines of final income documents. A line's ILS figure is its own
 * amount converted at its document's rate (document ILS total over document total, integer
 * division). A line with no catalog service groups by its description. Imported documents carry
 * no lines, so they are not part of this breakdown.
 */
export async function incomeByService(db: D1Database, from: string, to: string, limit?: number): Promise<Breakdown> {
  const rows = await all<{
    item_id: number | null;
    name_en: string;
    name_he: string | null;
    currency: string;
    qty: number;
    amount: number;
    ils: number | null;
    n: number;
  }>(
    db,
    `SELECT l.item_id, COALESCE(i.name_en, l.description_en) AS name_en, COALESCE(i.name_he, l.description_he) AS name_he, d.currency,
       SUM(CASE WHEN l.line_total_minor < 0 THEN -ABS(l.quantity_milli) ELSE ABS(l.quantity_milli) END) AS qty,
       SUM(l.line_total_minor) AS amount,
       SUM(CASE WHEN d.currency = 'ILS' THEN l.line_total_minor
                WHEN d.total_ils_minor IS NOT NULL AND d.total_minor <> 0 THEN l.line_total_minor * d.total_ils_minor / d.total_minor
           END) AS ils,
       COUNT(DISTINCT d.id) AS n
     FROM document_lines l
     JOIN documents d ON d.id = l.document_id
     JOIN document_types dt ON dt.code = d.type
     LEFT JOIN items i ON i.id = l.item_id
     WHERE d.status = 'final' AND dt.kind IN (${INCOME_KINDS}) AND d.date BETWEEN ? AND ?
     GROUP BY l.item_id, CASE WHEN l.item_id IS NULL THEN l.description_en END, d.currency`,
    from,
    to,
  );
  const map = new Map<string, ShareRow>();
  for (const r of rows) {
    const key = r.item_id !== null ? `item:${r.item_id}` : `line:${r.name_en}`;
    mergeShareRow(
      map,
      key,
      () => ({ key, nameEn: r.name_en, nameHe: r.name_he ?? r.name_en, ilsMinor: 0, byCurrency: {}, count: 0, quantityMilli: 0 }),
      r.currency,
      r.amount,
      r.ils,
      r.n,
      false,
    );
    const row = map.get(key)!;
    row.quantityMilli = (row.quantityMilli ?? 0) + r.qty;
    delete row.imported;
  }

  // Imported receipts, invoices and credits count under the service set on them with Edit.
  const imported = await all<{ item_id: number | null; name_en: string | null; name_he: string | null; currency: string; amount: number; ils: number | null; n: number }>(
    db,
    `SELECT x.item_id, i.name_en, i.name_he, x.currency,
       SUM(${externalSignSql('x.doc_type')} * x.total_minor) AS amount,
       SUM(${externalSignSql('x.doc_type')} * ${ILS('x.total_minor', 'x.currency', 'x.total_ils_minor')}) AS ils,
       COUNT(*) AS n
     FROM external_documents x LEFT JOIN items i ON i.id = x.item_id
     WHERE x.issue_date BETWEEN ? AND ? AND ${externalIsIncomeSql('x.doc_type')}
     GROUP BY x.item_id, x.currency`,
    from,
    to,
  );
  for (const r of imported) {
    const key = r.item_id !== null ? `item:${r.item_id}` : 'imported:none';
    const nameEn = r.name_en ?? 'Imported, no service';
    mergeShareRow(
      map,
      key,
      () => ({ key, nameEn, nameHe: r.name_he ?? (r.item_id !== null ? nameEn : 'מיובא, ללא שירות'), ilsMinor: 0, byCurrency: {}, count: 0, quantityMilli: 0 }),
      r.currency,
      r.amount,
      r.ils,
      r.n,
      false,
    );
    const row = map.get(key)!;
    row.quantityMilli = (row.quantityMilli ?? 0) + r.n * 1000;
    delete row.imported;
  }
  return foldBreakdown([...map.values()], limit);
}

/** Expenses per category. No category reads "Uncategorized". */
export async function expensesByCategory(db: D1Database, from: string, to: string, limit?: number): Promise<Breakdown> {
  const rows = await all<{ category_id: number | null; category_name: string | null; currency: string; amount: number; ils: number | null; n: number }>(
    db,
    `SELECT category_id, category_name, currency, SUM(amount_minor) AS amount, SUM(ils_minor) AS ils, COUNT(*) AS n
     FROM (${EXPENSE_ROWS_SQL}) GROUP BY category_id, currency`,
    from,
    to,
  );
  const map = new Map<string, ShareRow>();
  for (const r of rows) {
    const key = `category:${r.category_id ?? 'none'}`;
    const name = r.category_name ?? 'Uncategorized';
    const nameHe = r.category_name ?? 'ללא קטגוריה';
    mergeShareRow(map, key, () => ({ key, nameEn: name, nameHe, ilsMinor: 0, byCurrency: {}, count: 0 }), r.currency, r.amount, r.ils, r.n, false);
    delete map.get(key)!.imported;
  }
  return foldBreakdown([...map.values()], limit);
}

// ---------------------------------------------------------------------------
// Year comparison
// ---------------------------------------------------------------------------

export interface YearTotals {
  from: string;
  to: string;
  incomeIlsMinor: number;
  expensesIlsMinor: number;
  netIlsMinor: number;
}

export interface YearComparison {
  previousYear: YearTotals;
  samePeriodLastYear: YearTotals;
  yearToDate: YearTotals;
}

/** The same calendar day a year earlier. 29 February becomes 28 February. */
export function sameDayLastYear(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/** Previous full year, this year to date, and the same stretch of last year. One query. */
export async function yearComparison(db: D1Database, today: string): Promise<YearComparison> {
  const year = Number(today.slice(0, 4));
  const prevStart = `${year - 1}-01-01`;
  const prevEnd = `${year - 1}-12-31`;
  const ytdStart = `${year}-01-01`;
  const sameEnd = sameDayLastYear(today);
  const row = await first<Record<string, number | null>>(
    db,
    `SELECT
       SUM(CASE WHEN kind = 'i' AND date <= ? THEN ils END) AS prev_i,
       SUM(CASE WHEN kind = 'e' AND date <= ? THEN ils END) AS prev_e,
       SUM(CASE WHEN kind = 'i' AND date <= ? THEN ils END) AS same_i,
       SUM(CASE WHEN kind = 'e' AND date <= ? THEN ils END) AS same_e,
       SUM(CASE WHEN kind = 'i' AND date >= ? THEN ils END) AS ytd_i,
       SUM(CASE WHEN kind = 'e' AND date >= ? THEN ils END) AS ytd_e
     FROM (
       SELECT date, 'i' AS kind, ils_minor AS ils FROM (${INCOME_ROWS_SQL})
       UNION ALL
       SELECT date, 'e', ils_minor FROM (${EXPENSE_ROWS_SQL})
     )`,
    prevEnd,
    prevEnd,
    sameEnd,
    sameEnd,
    ytdStart,
    ytdStart,
    prevStart,
    today,
    prevStart,
    today,
    prevStart,
    today,
  );
  const totals = (from: string, to: string, i: number | null | undefined, e: number | null | undefined): YearTotals => ({
    from,
    to,
    incomeIlsMinor: i ?? 0,
    expensesIlsMinor: e ?? 0,
    netIlsMinor: (i ?? 0) - (e ?? 0),
  });
  return {
    previousYear: totals(prevStart, prevEnd, row?.prev_i, row?.prev_e),
    samePeriodLastYear: totals(prevStart, sameEnd, row?.same_i, row?.same_e),
    yearToDate: totals(ytdStart, today, row?.ytd_i, row?.ytd_e),
  };
}

// ---------------------------------------------------------------------------
// Open items and aging
// ---------------------------------------------------------------------------

export type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';
export const AGING_BUCKETS: AgingBucket[] = ['current', '1-30', '31-60', '61-90', '90+'];

export interface OpenItem {
  /** The document id, or the imported document id when `imported` is set. */
  documentId: number;
  /** A pro forma, payment request or tax invoice imported from another system. */
  imported?: boolean;
  type: string;
  typeNameEn: string;
  typeNameHe: string;
  displayNumber: string | null;
  clientId: number | null;
  clientNameEn: string;
  clientNameHe: string;
  date: string;
  dueDate: string | null;
  currency: string;
  remainingMinor: number;
  /** ILS projection: the rate frozen on the demand, else today's cached BOI rate. Null when neither exists. */
  ilsMinor: number | null;
  /** Days past the due date (or past the document date when there is none). Zero or less is not yet due. */
  daysOverdue: number;
  bucket: AgingBucket;
}

export function agingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * ILS projection of an open demand's remainder. The balance itself stays in its currency
 * (docs/currency-and-fx.md). Uses the rate frozen on the demand, or today's cached rate. A
 * currency with no cached rate yet returns null.
 */
export function demandIlsResolver(db: D1Database, today: string) {
  const todayRates = new Map<string, string | null>();
  return async (d: Pick<OpenDemand, 'currency' | 'remaining_minor' | 'fx_rate'>): Promise<number | null> => {
    if (d.currency === HOME_CURRENCY) return d.remaining_minor;
    let rate = d.fx_rate;
    if (!rate) {
      if (!todayRates.has(d.currency)) {
        try {
          todayRates.set(d.currency, (await rateOn(db, assertCurrency(d.currency), today)).rate);
        } catch (err) {
          if (!(err instanceof FxUnavailableError)) throw err;
          todayRates.set(d.currency, null);
        }
      }
      rate = todayRates.get(d.currency) ?? null;
    }
    return rate ? convert(d.remaining_minor, rate) : null;
  };
}

/** The type code an imported demand reports under: PR, 300 (pro forma) or 305 (tax invoice). */
function importedTypeCode(docType: string): string {
  if (/payment request|דרישת תשלום/i.test(docType)) return 'PR';
  if (/pro ?forma|חשבון עסקה/i.test(docType)) return '300';
  return '305';
}

/**
 * Every open payment request and pro forma, with client, age and bucket. Pass `demands` to reuse a load.
 * Open imported demands join the list, flagged `imported`. They carry no due date, so they are due
 * on their issue date.
 */
export async function openItems(db: D1Database, today: string, demands?: OpenDemand[]): Promise<OpenItem[]> {
  const list = demands ?? (await openDemands(db));
  const imported = await openImportedDemands(db);
  const meta = list.length === 0 ? [] : await all<{
    id: number;
    type: string;
    number: number | null;
    type_name_en: string;
    type_name_he: string | null;
    name_en: string | null;
    name_he: string | null;
  }>(
    db,
    `SELECT d.id, d.type, d.number, dt.name_en AS type_name_en, dt.name_he AS type_name_he, c.name_en, c.name_he
     FROM documents d JOIN document_types dt ON dt.code = d.type LEFT JOIN clients c ON c.id = d.client_id
     WHERE d.id IN (${list.map(() => '?').join(',')})`,
    ...list.map((d) => d.id),
  );
  const byId = new Map(meta.map((m) => [m.id, m]));
  const toIls = demandIlsResolver(db, today);
  const items: OpenItem[] = [];
  for (const d of list) {
    const m = byId.get(d.id);
    if (!m) continue;
    const days = daysBetween(d.due_date ?? d.date, today);
    items.push({
      documentId: d.id,
      type: m.type,
      typeNameEn: m.type_name_en,
      typeNameHe: m.type_name_he ?? m.type_name_en,
      displayNumber: displayNumber(m.type, m.number),
      clientId: d.client_id,
      clientNameEn: (m.name_en ?? '').trim() || (m.name_he ?? '').trim(),
      clientNameHe: (m.name_he ?? '').trim() || (m.name_en ?? '').trim(),
      date: d.date,
      dueDate: d.due_date,
      currency: d.currency,
      remainingMinor: d.remaining_minor,
      ilsMinor: await toIls(d),
      daysOverdue: days,
      bucket: agingBucket(days),
    });
  }
  for (const x of imported) {
    const days = daysBetween(x.issue_date, today);
    const en = (x.client_name_en ?? '').trim() || (x.client_name_he ?? '').trim() || x.client_name_text;
    const he = (x.client_name_he ?? '').trim() || (x.client_name_en ?? '').trim() || x.client_name_text;
    items.push({
      documentId: x.id,
      imported: true,
      type: importedTypeCode(x.doc_type),
      typeNameEn: x.doc_type,
      typeNameHe: x.doc_type,
      displayNumber: x.original_number,
      clientId: x.client_id,
      clientNameEn: en,
      clientNameHe: he,
      date: x.issue_date,
      dueDate: x.issue_date,
      currency: x.currency,
      remainingMinor: x.remaining_minor,
      ilsMinor:
        x.currency === HOME_CURRENCY
          ? x.remaining_minor
          : x.total_ils_minor
            ? Math.round((x.remaining_minor * x.total_ils_minor) / x.total_minor)
            : await toIls({ currency: x.currency, remaining_minor: x.remaining_minor, fx_rate: null }),
      daysOverdue: days,
      bucket: agingBucket(days),
    });
  }
  return items.sort((a, b) => b.daysOverdue - a.daysOverdue || a.documentId - b.documentId);
}

export interface AgingRow {
  bucket: AgingBucket;
  count: number;
  byCurrency: Money;
  ilsMinor: number;
}

/** Open items bucketed by days past due: coming due, 1-30, 31-60, 61-90, 90+. */
export function agingSummary(items: OpenItem[]): AgingRow[] {
  const rows = new Map<AgingBucket, AgingRow>(AGING_BUCKETS.map((bucket) => [bucket, { bucket, count: 0, byCurrency: {}, ilsMinor: 0 }]));
  for (const i of items) {
    const row = rows.get(i.bucket)!;
    row.count += 1;
    row.ilsMinor += i.ilsMinor ?? 0;
    addMoney(row.byCurrency, i.currency, i.remainingMinor);
  }
  return [...rows.values()];
}

/** Pro forma types: 300 is the one pro forma now, PF stays for documents issued before R18. */
export const PROFORMA_TYPES = ['300', 'PF'];
export const PAYMENT_REQUEST_TYPES = ['PR'];
