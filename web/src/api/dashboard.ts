import { apiGet } from './client';

export type EntityType = 'osek_patur' | 'osek_murshe' | 'company';

/** R25: one contract on a dashboard line. */
export interface ContractAlert {
  id: number;
  clientId: number;
  title: string;
  sentAt: string;
  expiresAt: string;
  daysSinceSent: number;
  daysLeft: number;
}

/** R28: a reminder the 07:00 run could not email, due on WhatsApp today. */
export interface WhatsAppDueItem {
  id: number;
  clientId: number;
  clientName: string;
  targetKind: 'document' | 'contract';
  targetId: number;
  label: string;
  rules: string[];
  phone: string | null;
}

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
  vatDue: {
    applicable: boolean;
    amountMinor: number;
    currency: string;
    /** R24: the current reporting period. Absent on an older Worker. */
    period?: { from: string; to: string; reportDue: string; reporting: 'monthly' | 'bimonthly' } | null;
    outputMinor?: number;
    inputMinor?: number;
  };
  /** R24: the business type. Absent on an older Worker. */
  businessType?: { entityType: EntityType; showCeiling: boolean };
  /** R24 Phase C: certificates that end within 30 days, or ended. Absent on an older Worker. */
  expiringDocuments?: { id: number; type: string; typeLabel: { en: string; he: string }; validUntil: string; daysLeft: number }[];
  /** R25: contracts unsigned after 7 days, and signing links that end within 2 days. */
  contracts?: { unsigned: ContractAlert[]; expiring: ContractAlert[] };
  /** R28: reminders due on WhatsApp today. Absent on an older Worker. */
  whatsappDue?: WhatsAppDueItem[];
  ita: { connected: boolean; message: string; state?: 'connected' | 'not_connected' | 'after_switch' };
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

/** R24: drops the cards that do not apply to this business type, so Customize hides them too. */
export async function fetchDashboardLayout(): Promise<LayoutEntry[]> {
  const body = await apiGet<{ cards: LayoutEntry[]; unavailable?: DashboardCard[] }>('/dashboard/layout');
  const skip = new Set(body.unavailable ?? []);
  return body.cards.filter((c) => !skip.has(c.id));
}

export const DEFAULT_LAYOUT: LayoutEntry[] = DASHBOARD_CARDS.map((id) => ({ id, visible: true }));
