import { apiGet } from '../../api/client';
import { apiSend } from '../documents/api';

/** R40: /api/financy. The connection, the sync, and Bank activity. No answer carries the secret. */

export interface SyncCounts {
  accounts: number;
  transactions: number;
  new: number;
  matched: number;
}

export interface FinancyConnection {
  connected: boolean;
  status: 'connected' | 'error' | 'disconnected' | null;
  clientId: string | null;
  secretLast4: string | null;
  userId: string | null;
  lastError: string | null;
  lastSyncAt: string | null;
  lastSyncResult: SyncCounts | null;
  /** R40 task 3b: the picked business accounts. */
  accountIds: string[];
  needsAccounts: boolean;
}

/** A CHECKING or CARD account Financy holds, offered in the picker. */
export interface AvailableAccount {
  id: string;
  type: 'CHECKING' | 'CARD';
  provider: string | null;
  name: string | null;
  last4: string | null;
  currencies: string[];
  blocked: boolean;
  dueDay: string | null;
  picked: boolean;
}

export interface FinancyDetails {
  clientId: string;
  clientSecret: string;
  userId: string;
}

export type MatchStatus = 'unmatched' | 'matched' | 'ignored' | 'added';
/** R42: normal money, a transfer between own accounts, or a card bill paid from checking. */
export type Flow = 'normal' | 'own_transfer' | 'card_payment';
/** R42: the status column. */
export type RowStatus = 'matched' | 'to_match' | 'suggested' | 'not_business' | 'not_counted';

export interface BankAccount {
  id: string;
  type: string;
  name: string | null;
  last4: string | null;
  currency: string | null;
  balanceMinor: number | null;
  balanceType: string | null;
  availableMinor: number | null;
  creditLimitMinor: number | null;
  /** A full date, or the day of the month the card is charged. */
  cardDueDate: string | null;
  /** One entry per currency, shekels first. */
  balances: { currency: string; balanceMinor: number; balanceType: string }[];
  blocked: boolean;
  updatedAt: string;
}

export interface BankTransaction {
  id: number;
  date: string;
  kind: 'BANK' | 'CARD';
  accountId: string | null;
  accountName: string | null;
  accountLast4: string | null;
  amountMinor: number;
  currency: string;
  originalAmountMinor: number | null;
  originalCurrency: string | null;
  description: string | null;
  merchant: string | null;
  categoryMain: string | null;
  categorySub: string | null;
  category: string | null;
  installment: { number: number; total: number } | null;
  matchStatus: MatchStatus;
  flow: Flow;
  status: RowStatus;
  expenseId: number | null;
  suggestion: { documentId: number; displayNumber: string | null } | null;
}

export interface Tally {
  income: number;
  expenses: number;
  net: number;
}

export interface CategoryRow {
  key: string;
  label: string;
  amount: number;
  /** Basis points: 4500 is 45%. */
  shareBp: number;
}

/** R42: GET /api/financy/dashboard. Shekel minor units. */
export interface FinancyDashboardData {
  accountCount: number;
  lastSyncAt: string | null;
  status: 'connected' | 'error';
  months: number;
  liquidity: { cash: number; cardsCurrent: number; net: number };
  month: { month: string; previousMonth: string; current: Tally; previous: Tally; changePct: { income: number | null; expenses: number | null; net: number | null } };
  cashflow: { month: string; income: number; expenses: number }[];
  categories: { expenses: { total: number; rows: CategoryRow[] }; income: { total: number; rows: CategoryRow[] } };
  accounts: {
    checking: { totals: Record<string, number>; rows: { id: string; provider: string | null; name: string | null; last4: string | null; balances: { currency: string; balanceMinor: number; ilsMinor: number | null }[] }[] };
    cards: { totalCurrent: number; rows: { id: string; provider: string | null; name: string | null; last4: string | null; currentMinor: number; statementMinor: number | null; dueDay: string | null; blocked: boolean }[] };
  };
  recent: BankTransaction[];
  toMatch: { out: { count: number; sum: number }; in: { count: number; sum: number } };
  excluded: { sum: number; ownTransfer: number; cardPayment: number };
  unconverted: string[];
}

export interface MatchCandidate {
  kind: 'expense' | 'document';
  id: number;
  label: string;
  date: string | null;
  amountMinor: number;
  currency: string;
}

export interface ActivityFilter {
  month?: string;
  account?: string;
  direction?: 'in' | 'out';
  status?: MatchStatus;
  flow?: Flow;
}

export const financyApi = {
  get: () => apiGet<{ connection: FinancyConnection }>('/financy'),
  connect: (details: FinancyDetails) => apiSend<{ connection: FinancyConnection; accounts: AvailableAccount[] }>('PUT', '/financy', details),
  availableAccounts: () => apiGet<{ accounts: AvailableAccount[] }>('/financy/available-accounts'),
  pickAccounts: (accountIds: string[], confirm = false) =>
    apiSend<{ connection: FinancyConnection; sync: SyncCounts | null; deletedTransactions: number }>('PUT', '/financy/picked-accounts', { accountIds, confirm }),
  sync: () => apiSend<{ connection: FinancyConnection; sync: SyncCounts }>('POST', '/financy/sync'),
  disconnect: () => apiSend<{ connection: FinancyConnection }>('DELETE', '/financy'),
  deleteData: () => apiSend<{ deleted: { accounts: number; transactions: number } }>('DELETE', '/financy/data'),
  transactions: (filter: ActivityFilter) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) if (v) q.set(k, v);
    const qs = q.toString();
    return apiGet<{ transactions: BankTransaction[]; accounts: BankAccount[]; canEdit: boolean }>(`/financy/transactions${qs ? `?${qs}` : ''}`);
  },
  addExpense: (id: number) => apiSend<{ expenseId: number; transaction: BankTransaction }>('POST', `/financy/transactions/${id}/add-expense`),
  ignore: (id: number) => apiSend<{ transaction: BankTransaction }>('POST', `/financy/transactions/${id}/ignore`),
  // R42
  dashboard: (months: 3 | 6) => apiGet<{ dashboard: FinancyDashboardData | null }>(`/financy/dashboard?months=${months}`),
  count: (id: number) => apiSend<{ transaction: BankTransaction }>('POST', `/financy/transactions/${id}/count`),
  candidates: (id: number, q = '') => apiGet<{ candidates: MatchCandidate[] }>(`/financy/transactions/${id}/candidates${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  match: (id: number, target: { expenseId: number } | { documentId: number }) => apiSend<{ transaction: BankTransaction }>('PUT', `/financy/transactions/${id}/match`, target),
  unmatch: (id: number) => apiSend<{ transaction: BankTransaction }>('DELETE', `/financy/transactions/${id}/match`),
};

/** "2026-10-20T07:00:12.345Z" as "2026-10-20 07:00". */
export const shortTime = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');

export { formatMinor } from '../expenses/format';
