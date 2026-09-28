import { apiGet } from './client';

export interface IncomeRow {
  documentId: number;
  date: string;
  type: string;
  typeNameEn: string;
  displayNumber: string | null;
  clientId: number | null;
  clientName: string | null;
  currency: string;
  amountMinor: number;
  amountIlsMinor: number | null;
  /** Set for a document imported from SUMIT or Wave. */
  externalSource?: string;
}
export interface MonthTotal {
  month: string;
  totalIlsMinor: number;
}
export interface IncomeReport {
  from: string;
  to: string;
  rows: IncomeRow[];
  byMonth: MonthTotal[];
  byClient: { clientId: number | null; clientName: string | null; totalIlsMinor: number }[];
  byCurrency: { currency: string; totalMinor: number; totalIlsMinor: number }[];
  totalIlsMinor: number;
}

export interface ExpenseRow {
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
export interface ExpenseReport {
  from: string;
  to: string;
  rows: ExpenseRow[];
  byMonth: MonthTotal[];
  byCategory: { categoryId: number | null; categoryName: string | null; totalIlsMinor: number }[];
  bySupplier: { supplierId: number | null; supplierName: string | null; totalIlsMinor: number }[];
  totalIlsMinor: number;
}

export interface ProfitLossReport {
  from: string;
  to: string;
  months: { month: string; incomeIlsMinor: number; expensesIlsMinor: number; netIlsMinor: number }[];
  incomeIlsMinor: number;
  expensesIlsMinor: number;
  netIlsMinor: number;
}

export interface AdvanceBaseReport {
  from: string;
  to: string;
  months: MonthTotal[];
  totalIlsMinor: number;
}

export interface CeilingMeter {
  year: number;
  currency: string;
  limitMinor: number;
  turnoverMinor: number;
  openRequestsMinor: number;
  currentMinor: number;
  legalMode: 'patur' | 'murshe';
  percent: number;
}

export interface AccountantPack {
  id: number;
  period: string;
  expense_file_count: number;
  income_total_ils_minor: number;
  expense_total_ils_minor: number;
  generated_at: string;
  emailed_at: string | null;
  email_error: string | null;
}

const qs = (from: string, to: string) => `from=${from}&to=${to}`;

export const fetchIncomeReport = (from: string, to: string) => apiGet<IncomeReport>(`/reports/income?${qs(from, to)}`);
export const fetchExpenseReport = (from: string, to: string) => apiGet<ExpenseReport>(`/reports/expenses?${qs(from, to)}`);
export const fetchProfitLoss = (from: string, to: string) => apiGet<ProfitLossReport>(`/reports/profit-loss?${qs(from, to)}`);
export const fetchAdvanceBase = (from: string, to: string) => apiGet<AdvanceBaseReport>(`/reports/advance-base?${qs(from, to)}`);
export const fetchCeilingMeter = () => apiGet<{ meter: CeilingMeter | null }>('/ceiling/meter');
export const fetchAccountantPacks = () => apiGet<{ packs: AccountantPack[] }>('/reports/packs');

// ---------------------------------------------------------------------------
// R21 report catalog: one shape for every report in /api/reports/r/:id
// ---------------------------------------------------------------------------

export type ColumnKind = 'text' | 'date' | 'month' | 'int' | 'quantity' | 'ils' | 'money' | 'moneyList';

export interface ReportColumn {
  key: string;
  header: string;
  kind: ColumnKind;
  total?: boolean;
}

export interface MoneyValue {
  minor: number;
  currency: string;
}

export type Cell = string | number | null | MoneyValue | Record<string, number>;

export type ReportLink =
  | { kind: 'document'; id: number }
  | { kind: 'expense'; id: number }
  | { kind: 'client'; id: number }
  | { kind: 'report'; report: string; params: Record<string, string> };

export interface ReportRow {
  key: string;
  cells: Record<string, Cell>;
  link?: ReportLink;
  imported?: boolean;
}

export interface ReportResult {
  report: string;
  title: string;
  from: string;
  to: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: Record<string, number>;
}

/** Query string for a report: the period plus any filters. */
export function reportQuery(from: string, to: string, filters: Record<string, string> = {}): string {
  return new URLSearchParams({ from, to, ...filters }).toString();
}

export const fetchReport = (id: string, from: string, to: string, filters: Record<string, string> = {}) =>
  apiGet<ReportResult>(`/reports/r/${id}?${reportQuery(from, to, filters)}`);

export interface ClientLedgerEntry {
  kind: 'document' | 'payment';
  date: string;
  document_id: number;
  type_name_en: string;
  display_number: string | null;
  description: string;
  currency: string;
  debit_minor: number;
  credit_minor: number;
  balance_minor: number;
  balance_ils_minor: number;
}

export interface ClientLedgersReport {
  from: string;
  to: string;
  clients: { clientId: number; clientName: string; closingIlsMinor: number; ledger: { entries: ClientLedgerEntry[] } }[];
}

export const fetchClientLedgers = (from: string, to: string) => apiGet<ClientLedgersReport>(`/reports/client-ledgers?${qs(from, to)}`);
