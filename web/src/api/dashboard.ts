import { apiGet } from './client';

export interface CurrencyTotal {
  currency: string;
  count: number;
  totalMinor: number;
}

export type Money = Record<string, number>;

export interface Range {
  from: string;
  to: string;
}

export interface OpenItem {
  documentId: number;
  /** Imported from another system. `documentId` is then the imported document id. */
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
  ilsMinor: number | null;
  daysOverdue: number;
  bucket: AgingBucket;
}

export type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export interface CashFlowMonth {
  month: string;
  inflowIlsMinor: number;
  importedInflowIlsMinor: number;
  outflowIlsMinor: number;
  netIlsMinor: number;
}

export interface ProfitLossMonth {
  month: string;
  incomeIlsMinor: number;
  importedIncomeIlsMinor: number;
  expensesIlsMinor: number;
  netIlsMinor: number;
}

export interface IncomeMonth {
  month: string;
  issuedIlsMinor: number;
  importedIlsMinor: number;
  totalIlsMinor: number;
}

export interface ShareRow {
  key: string;
  nameEn: string;
  nameHe: string;
  ilsMinor: number;
  byCurrency: Money;
  count: number;
  imported?: boolean;
  quantityMilli?: number;
}

export interface Breakdown {
  rows: ShareRow[];
  other: ShareRow | null;
  totalIlsMinor: number;
}

export interface YearTotals {
  from: string;
  to: string;
  incomeIlsMinor: number;
  expensesIlsMinor: number;
  netIlsMinor: number;
}

export interface AgingRow {
  bucket: AgingBucket;
  count: number;
  byCurrency: Money;
  ilsMinor: number;
}

export interface DashboardCards {
  overdue?: { items: OpenItem[]; overdueRequests: CurrencyTotal[]; openProformas: CurrencyTotal[] };
  cashFlow?: Range & { months: CashFlowMonth[] };
  profitLoss?: Range & { months: ProfitLossMonth[] };
  incomeByMonth?: Range & { months: IncomeMonth[]; totalIlsMinor: number; importedIlsMinor: number };
  topClients?: Range & Breakdown;
  topServices?: Range & Breakdown;
  expenseCategories?: Range & Breakdown;
  yearComparison?: { previousYear: YearTotals; samePeriodLastYear: YearTotals; yearToDate: YearTotals };
  aging?: { buckets: AgingRow[] };
}

export interface DashboardData {
  today: string;
  overdueRequests: CurrencyTotal[];
  ceiling: { year: number; currency: string; limitMinor: number; currentMinor: number } | null;
  vatDue: { applicable: boolean; amountMinor: number; currency: string };
  ita: { connected: boolean; message: string };
  cards: DashboardCards;
  /** Present when the call named no cards: the stored layout that picked them. */
  layout?: LayoutEntry[];
}

export const DASHBOARD_CARDS = [
  'quickActions',
  'overdue',
  'cashFlow',
  'profitLoss',
  'incomeByMonth',
  'topClients',
  'topServices',
  'expenseCategories',
  'yearComparison',
  'aging',
  'ceiling',
  'vat',
  'ita',
] as const;
export type DashboardCard = (typeof DASHBOARD_CARDS)[number];

export type PeriodCard = 'cashFlow' | 'profitLoss' | 'incomeByMonth' | 'topClients' | 'topServices' | 'expenseCategories';

export interface DashboardQuery {
  cards?: DashboardCard[];
  ranges?: Partial<Record<PeriodCard, Range>>;
}

export function dashboardPath(query: DashboardQuery = {}): string {
  const params = new URLSearchParams();
  if (query.cards) params.set('cards', query.cards.join(','));
  for (const [card, r] of Object.entries(query.ranges ?? {})) params.set(card, `${r.from}..${r.to}`);
  const qs = params.toString();
  return qs ? `/dashboard?${qs}` : '/dashboard';
}

/** GET /api/dashboard: every requested card in one call. */
export async function fetchDashboard(query: DashboardQuery = {}): Promise<DashboardData> {
  return apiGet<DashboardData>(dashboardPath(query));
}

export interface LayoutEntry {
  id: DashboardCard;
  visible: boolean;
}

export async function fetchDashboardLayout(): Promise<LayoutEntry[]> {
  return (await apiGet<{ cards: LayoutEntry[] }>('/dashboard/layout')).cards;
}

export const DEFAULT_LAYOUT: LayoutEntry[] = DASHBOARD_CARDS.map((id) => ({ id, visible: true }));
