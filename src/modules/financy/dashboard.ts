import { all } from '../../core/db';
import { type Currency, convert, isCurrency } from '../../core/money';
import type { RateSource } from '../fx';
import { type BankTransactionView, listBankAccounts, listBankTransactions } from './activity';
import { categoryLabel } from './categories';
import { loadConnection, pickedIds } from './connection';

/**
 * R42 task 2: the Financy Dashboard tab's numbers in one call, from the picked accounts' rows. Only
 * normal money counts (flows.ts): a transfer between own accounts or a card bill paid from checking
 * is left out of income, expenses and categories, and summed as `excluded`. Amounts are shekel
 * minor units. Another currency converts at today's Bank of Israel rate; one with no rate is listed
 * in `unconverted` and left out of the totals.
 */

export interface Tally {
  income: number;
  expenses: number;
  net: number;
}

export interface CategoryRow {
  key: string;
  label: string;
  amount: number;
  /** Basis points of the period total: 4500 is 45%. */
  shareBp: number;
}

export interface FinancyDashboard {
  accountCount: number;
  lastSyncAt: string | null;
  status: 'connected' | 'error';
  months: number;
  liquidity: { cash: number; cardsCurrent: number; net: number };
  month: { month: string; previousMonth: string; current: Tally; previous: Tally; changePct: { income: number | null; expenses: number | null; net: number | null } };
  cashflow: { month: string; income: number; expenses: number }[];
  categories: { expenses: { total: number; rows: CategoryRow[] }; income: { total: number; rows: CategoryRow[] } };
  accounts: {
    checking: {
      totals: Record<string, number>;
      rows: { id: string; provider: string | null; name: string | null; last4: string | null; balances: { currency: string; balanceMinor: number; ilsMinor: number | null }[] }[];
    };
    cards: {
      totalCurrent: number;
      rows: { id: string; provider: string | null; name: string | null; last4: string | null; currentMinor: number; statementMinor: number | null; dueDay: string | null; blocked: boolean }[];
    };
  };
  recent: BankTransactionView[];
  toMatch: { out: { count: number; sum: number }; in: { count: number; sum: number } };
  excluded: { sum: number; ownTransfer: number; cardPayment: number };
  unconverted: string[];
}

/** Top categories shown on their own. The rest is one "Other" row. */
export const TOP_CATEGORIES = 6;

const monthOf = (date: string) => date.slice(0, 7);

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

function changePct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

function topCategories(byKey: Map<string, number>, otherLabel = 'Other'): { total: number; rows: CategoryRow[] } {
  const total = [...byKey.values()].reduce((s, v) => s + v, 0);
  const sorted = [...byKey.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, TOP_CATEGORIES);
  const rest = sorted.slice(TOP_CATEGORIES).reduce((s, [, v]) => s + v, 0);
  const rows: CategoryRow[] = top.map(([key, amount]) => ({ key, label: key === '' ? 'No category' : (categoryLabel(key) ?? key), amount, shareBp: total ? Math.round((amount / total) * 10000) : 0 }));
  if (rest > 0) rows.push({ key: 'OTHER_REST', label: otherLabel, amount: rest, shareBp: total ? Math.round((rest / total) * 10000) : 0 });
  return { total, rows };
}

interface Row {
  id: number;
  booked_on: string;
  amount_minor: number;
  currency: string;
  category_main: string | null;
  flow: string;
  match_status: string;
  matched_document_id: number | null;
}

export async function financyDashboard(db: D1Database, fx: RateSource, businessId: number, today: string, months = 3): Promise<FinancyDashboard | null> {
  const connection = await loadConnection(db, businessId);
  if (!connection || connection.status === 'disconnected' || pickedIds(connection).length === 0) return null;
  const span = months === 6 ? 6 : 3;

  // One rate per currency, today's. A currency the Ledger cannot convert stays out of the totals.
  const rates = new Map<string, string | null>();
  const unconverted = new Set<string>();
  async function toIls(minor: number, currency: string): Promise<number | null> {
    if (currency === 'ILS') return minor;
    if (!rates.has(currency)) {
      let rate: string | null = null;
      if (isCurrency(currency)) {
        try {
          rate = (await fx.rateFor(currency as Currency, today)).rate;
        } catch {
          rate = null;
        }
      }
      rates.set(currency, rate);
    }
    const rate = rates.get(currency);
    if (!rate) {
      unconverted.add(currency);
      return null;
    }
    return convert(minor, rate);
  }

  // Accounts.
  const accounts = await listBankAccounts(db, businessId);
  const checkingRows = [];
  const totals: Record<string, number> = {};
  let cash = 0;
  for (const a of accounts.filter((x) => x.type === 'CHECKING')) {
    const balances = [];
    for (const b of a.balances) {
      totals[b.currency] = (totals[b.currency] ?? 0) + b.balanceMinor;
      const ils = await toIls(b.balanceMinor, b.currency);
      if (ils !== null) cash += ils;
      balances.push({ currency: b.currency, balanceMinor: b.balanceMinor, ilsMinor: ils });
    }
    checkingRows.push({ id: a.id, provider: a.provider, name: a.name, last4: a.last4, balances });
  }
  const cardRows = [];
  let cardsCurrent = 0;
  for (const a of accounts.filter((x) => x.type === 'CARD')) {
    const current = Math.abs(a.balanceMinor ?? 0);
    const ils = await toIls(current, a.currency ?? 'ILS');
    if (ils !== null) cardsCurrent += ils;
    cardRows.push({ id: a.id, provider: a.provider, name: a.name, last4: a.last4, currentMinor: current, statementMinor: a.statementMinor === null ? null : Math.abs(a.statementMinor), dueDay: a.cardDueDate, blocked: a.blocked });
  }

  // Rows of the window: `span` months back, the current month included.
  const thisMonth = monthOf(today);
  const firstMonth = addMonths(thisMonth, -(span - 1));
  const previousMonth = addMonths(thisMonth, -1);
  const from = `${[firstMonth, previousMonth].sort()[0]}-01`;
  const rows = await all<Row>(
    db,
    `SELECT id, booked_on, amount_minor, currency, category_main, flow, match_status, matched_document_id
       FROM bank_transactions WHERE business_id = ? AND booked_on >= ? AND booked_on <= ?`,
    businessId,
    from,
    today,
  );

  const byMonth = new Map<string, Tally>();
  const tally = (m: string) => {
    let t = byMonth.get(m);
    if (!t) byMonth.set(m, (t = { income: 0, expenses: 0, net: 0 }));
    return t;
  };
  const outCats = new Map<string, number>();
  const inCats = new Map<string, number>();
  const excluded = { sum: 0, ownTransfer: 0, cardPayment: 0 };
  for (const r of rows) {
    const ils = await toIls(r.amount_minor, r.currency);
    if (ils === null) continue;
    const m = monthOf(r.booked_on);
    if (r.flow !== 'normal') {
      // The money-out side, this month: what moved between accounts or paid a card bill.
      if (m === thisMonth && ils < 0) {
        excluded.sum += -ils;
        if (r.flow === 'own_transfer') excluded.ownTransfer += -ils;
        else excluded.cardPayment += -ils;
      }
      continue;
    }
    const t = tally(m);
    if (ils > 0) t.income += ils;
    else t.expenses += -ils;
    if (m >= firstMonth) {
      const key = r.category_main ?? '';
      if (ils > 0) inCats.set(key, (inCats.get(key) ?? 0) + ils);
      else outCats.set(key, (outCats.get(key) ?? 0) + -ils);
    }
  }
  for (const t of byMonth.values()) t.net = t.income - t.expenses;
  const current = byMonth.get(thisMonth) ?? { income: 0, expenses: 0, net: 0 };
  const previous = byMonth.get(previousMonth) ?? { income: 0, expenses: 0, net: 0 };

  const cashflow = [];
  for (let i = span - 1; i >= 0; i -= 1) {
    const m = addMonths(thisMonth, -i);
    const t = byMonth.get(m) ?? { income: 0, expenses: 0, net: 0 };
    cashflow.push({ month: m, income: t.income, expenses: t.expenses });
  }

  // To match: counted money out with no expense, and deposits with a suggested document. All months pulled.
  const open = await all<{ amount_minor: number; currency: string; matched_document_id: number | null }>(
    db,
    `SELECT amount_minor, currency, matched_document_id FROM bank_transactions
      WHERE business_id = ? AND flow = 'normal' AND match_status = 'unmatched' AND (amount_minor < 0 OR matched_document_id IS NOT NULL)`,
    businessId,
  );
  const toMatch = { out: { count: 0, sum: 0 }, in: { count: 0, sum: 0 } };
  for (const r of open) {
    const ils = (await toIls(Math.abs(r.amount_minor), r.currency)) ?? 0;
    const side = r.amount_minor < 0 ? toMatch.out : toMatch.in;
    side.count += 1;
    side.sum += ils;
  }

  return {
    accountCount: accounts.length,
    lastSyncAt: connection.last_sync_at,
    status: connection.status === 'error' ? 'error' : 'connected',
    months: span,
    liquidity: { cash, cardsCurrent, net: cash - cardsCurrent },
    month: {
      month: thisMonth,
      previousMonth,
      current,
      previous,
      changePct: { income: changePct(current.income, previous.income), expenses: changePct(current.expenses, previous.expenses), net: changePct(current.net, previous.net) },
    },
    cashflow,
    categories: { expenses: topCategories(outCats), income: topCategories(inCats) },
    accounts: {
      checking: { totals, rows: checkingRows },
      cards: { totalCurrent: cardsCurrent, rows: cardRows },
    },
    recent: await listBankTransactions(db, businessId, { limit: 20 }),
    toMatch,
    excluded,
    unconverted: [...unconverted].sort(),
  };
}
