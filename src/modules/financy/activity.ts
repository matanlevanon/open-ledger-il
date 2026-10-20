import { type AuditActor, actorBiz, auditStatement } from '../../core/audit';
import { all, first, nowIso, stmt, transaction } from '../../core/db';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors';
import { formatMinor, isCurrency } from '../../core/money';
import type { Env } from '../../env';
import { displayNumber } from '../documents/types';
import { recordGivenExpense } from '../expenses/service';
import { boiRateSource } from '../fx';
import { categoryLabel } from './categories';
import { loadConnection } from './connection';

/**
 * R40 tasks 4, 6 and 7: what the pulled bank data shows. The Bank activity list and its two
 * actions, the dashboard's Bank card, and the rows of the Bank vs books report.
 */

export const MATCH_STATUSES = ['unmatched', 'matched', 'ignored', 'added'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export interface BankTransactionView {
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
  /** Financy's codes, the person's change first. The web shows them with labels. */
  categoryMain: string | null;
  categorySub: string | null;
  /** The English label, for MCP. */
  category: string | null;
  installment: { number: number; total: number } | null;
  matchStatus: MatchStatus;
  expenseId: number | null;
  /** A suggested payment request or transaction invoice for money in. Nothing is recorded yet. */
  suggestion: { documentId: number; displayNumber: string | null; remainingMinor: number | null } | null;
}

export interface ActivityFilter {
  /** YYYY-MM */
  month?: string;
  accountId?: string;
  direction?: 'in' | 'out';
  status?: MatchStatus;
  limit?: number;
}

interface TxSqlRow {
  id: number;
  booked_on: string;
  kind: 'BANK' | 'CARD';
  account_financy_id: string | null;
  account_name: string | null;
  masked_number: string | null;
  amount_minor: number;
  currency: string;
  original_amount_minor: number | null;
  original_currency: string | null;
  description: string | null;
  merchant: string | null;
  category_main: string | null;
  category_sub: string | null;
  installment_number: number | null;
  installment_total: number | null;
  match_status: MatchStatus;
  matched_expense_id: number | null;
  matched_document_id: number | null;
  doc_type: string | null;
  doc_number: number | null;
}

function view(r: TxSqlRow): BankTransactionView {
  return {
    id: r.id,
    date: r.booked_on,
    kind: r.kind,
    accountId: r.account_financy_id,
    accountName: r.account_name,
    accountLast4: r.masked_number,
    amountMinor: r.amount_minor,
    currency: r.currency,
    originalAmountMinor: r.original_amount_minor,
    originalCurrency: r.original_currency,
    description: r.description,
    merchant: r.merchant,
    categoryMain: r.category_main,
    categorySub: r.category_sub,
    category: [categoryLabel(r.category_main), categoryLabel(r.category_sub)].filter(Boolean).join(' / ') || null,
    installment: r.installment_number !== null && r.installment_total !== null ? { number: r.installment_number, total: r.installment_total } : null,
    matchStatus: r.match_status,
    expenseId: r.matched_expense_id,
    suggestion:
      r.matched_document_id !== null && r.match_status === 'unmatched'
        ? { documentId: r.matched_document_id, displayNumber: displayNumber(r.doc_type ?? '', r.doc_number), remainingMinor: null }
        : null,
  };
}

const TX_SELECT = `SELECT t.*, a.name AS account_name, a.masked_number, d.type AS doc_type, d.number AS doc_number
  FROM bank_transactions t
  LEFT JOIN bank_accounts a ON a.business_id = t.business_id AND a.financy_id = t.account_financy_id
  LEFT JOIN documents d ON d.id = t.matched_document_id`;

export async function listBankTransactions(db: D1Database, businessId: number, filter: ActivityFilter): Promise<BankTransactionView[]> {
  const clauses = ['t.business_id = ?'];
  const params: (string | number)[] = [businessId];
  if (filter.month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(filter.month)) throw new ValidationError('Use YYYY-MM for the month.');
    clauses.push("strftime('%Y-%m', t.booked_on) = ?");
    params.push(filter.month);
  }
  if (filter.accountId) {
    clauses.push('t.account_financy_id = ?');
    params.push(filter.accountId);
  }
  if (filter.direction === 'in') clauses.push('t.amount_minor > 0');
  if (filter.direction === 'out') clauses.push('t.amount_minor < 0');
  if (filter.status) {
    clauses.push('t.match_status = ?');
    params.push(filter.status);
  }
  const limit = Math.min(Math.max(filter.limit ?? 500, 1), 1000);
  return (await all<TxSqlRow>(db, `${TX_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY t.booked_on DESC, t.id DESC LIMIT ${limit}`, ...params)).map(view);
}

async function loadTx(db: D1Database, id: number, businessId: number): Promise<TxSqlRow> {
  const row = await first<TxSqlRow>(db, `${TX_SELECT} WHERE t.id = ? AND t.business_id = ?`, id, businessId);
  if (!row) throw new NotFoundError('Bank transaction', id);
  return row;
}

/**
 * Money out with no expense becomes an expense waiting for its receipt: status new, typed by hand,
 * no file. The bank row is marked added and points at it.
 */
export async function addAsExpense(env: Env, id: number, actor: AuditActor): Promise<{ expenseId: number; transaction: BankTransactionView }> {
  const businessId = actorBiz(actor);
  const tx = await loadTx(env.DB, id, businessId);
  if (tx.amount_minor >= 0 || tx.match_status !== 'unmatched') {
    throw new ConflictError('bank_not_addable', 'Only money out that is not matched yet can be added as an expense.');
  }
  if (!isCurrency(tx.currency)) throw new ConflictError('bank_currency', `The Ledger keeps expenses in ILS, USD, EUR or GBP, not ${tx.currency}. Add this one by hand.`);
  const supplierName = tx.merchant?.trim() || tx.description?.trim() || 'Bank charge';
  const result = await recordGivenExpense(
    env,
    boiRateSource(env.DB),
    {
      fields: {
        supplierName,
        supplierId: null,
        documentNumber: null,
        date: tx.booked_on,
        currency: tx.currency,
        amount: formatMinor(-tx.amount_minor, tx.currency),
        vatAmount: null,
        documentType: null,
      },
      file: null,
      note: `From bank: ${tx.description ?? supplierName}`.slice(0, 300),
      source: 'bank',
    },
    actor,
  );
  if (result.kind !== 'created') throw new ConflictError('bank_not_addable', 'This expense is already recorded.');
  await transaction(env.DB, [
    stmt(env.DB, "UPDATE bank_transactions SET match_status = 'added', matched_expense_id = ?, updated_at = ? WHERE id = ?", result.expense.id, nowIso(), id),
    auditStatement(env.DB, actor, 'financy.add_expense', 'bank_transaction', id, { expenseId: result.expense.id }),
  ]);
  return { expenseId: result.expense.id, transaction: view(await loadTx(env.DB, id, businessId)) };
}

/** Not a business expense. Only an unmatched row can be ignored. */
export async function ignoreTransaction(db: D1Database, id: number, actor: AuditActor): Promise<BankTransactionView> {
  const businessId = actorBiz(actor);
  const tx = await loadTx(db, id, businessId);
  if (tx.match_status !== 'unmatched') throw new ConflictError('bank_not_ignorable', 'Only a row that is not matched yet can be set aside.');
  await transaction(db, [
    stmt(db, "UPDATE bank_transactions SET match_status = 'ignored', updated_at = ? WHERE id = ?", nowIso(), id),
    auditStatement(db, actor, 'financy.ignore', 'bank_transaction', id, {}),
  ]);
  return view(await loadTx(db, id, businessId));
}

export interface BankAccountView {
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

export async function listBankAccounts(db: D1Database, businessId: number): Promise<BankAccountView[]> {
  const rows = await all<{
    financy_id: string;
    account_type: string;
    name: string | null;
    masked_number: string | null;
    currency: string | null;
    balance_minor: number | null;
    balance_type: string | null;
    available_minor: number | null;
    credit_limit_minor: number | null;
    card_due_date: string | null;
    balances_json: string | null;
    blocked: number;
    updated_at: string;
  }>(db, "SELECT * FROM bank_accounts WHERE business_id = ? ORDER BY CASE account_type WHEN 'CHECKING' THEN 0 WHEN 'CARD' THEN 1 ELSE 2 END, name", businessId);
  return rows.map((r) => ({
    id: r.financy_id,
    type: r.account_type,
    name: r.name,
    last4: r.masked_number,
    currency: r.currency,
    balanceMinor: r.balance_minor,
    balanceType: r.balance_type,
    availableMinor: r.available_minor,
    creditLimitMinor: r.credit_limit_minor,
    cardDueDate: r.card_due_date,
    balances: parseBalances(r.balances_json, r.currency, r.balance_minor, r.balance_type),
    blocked: r.blocked === 1,
    updatedAt: r.updated_at,
  }));
}

function parseBalances(json: string | null, currency: string | null, minor: number | null, type: string | null): BankAccountView['balances'] {
  try {
    const list = json ? (JSON.parse(json) as BankAccountView['balances']) : [];
    if (Array.isArray(list) && list.length > 0) return list;
  } catch {
    // Fall back to the single columns.
  }
  return minor !== null && currency ? [{ currency, balanceMinor: minor, balanceType: type ?? '' }] : [];
}

export interface BankSummary {
  lastSyncAt: string | null;
  status: 'connected' | 'error';
  accounts: BankAccountView[];
}

/** The dashboard's Bank card: checking accounts and cards. Null when Financy is not connected. */
export async function bankSummary(db: D1Database, businessId: number): Promise<BankSummary | null> {
  const row = await loadConnection(db, businessId);
  if (!row || row.status === 'disconnected') return null;
  const accounts = (await listBankAccounts(db, businessId)).filter((a) => a.type === 'CHECKING' || a.type === 'CARD');
  return { lastSyncAt: row.last_sync_at, status: row.status, accounts };
}

/** MCP and the routes refuse plainly when nothing is connected. */
export async function assertConnected(db: D1Database, businessId: number): Promise<void> {
  const row = await loadConnection(db, businessId);
  if (!row || row.status === 'disconnected') {
    throw new ConflictError('financy_not_connected', 'Financy is not connected. Connect it in Settings > Expenses > Financy connection.');
  }
}

// ---------------------------------------------------------------------------
// Bank vs books (task 7)
// ---------------------------------------------------------------------------

export interface BankVsBooksLine {
  month: string;
  line: string;
  count: number | null;
  ils: number;
  /** The Bank activity filter this line opens, when it has one. */
  status?: MatchStatus;
}

/**
 * Per month: money out from the bank by Financy category, money out recorded as expenses, money
 * in from the bank, money in recorded as receipts, and the two gaps. Bank sums take ILS rows only.
 */
export async function bankVsBooks(db: D1Database, from: string, to: string, businessId: number): Promise<BankVsBooksLine[]> {
  const bankOut = await all<{ month: string; category: string | null; n: number; total: number }>(
    db,
    `SELECT strftime('%Y-%m', booked_on) AS month, category_main AS category, COUNT(*) AS n, -SUM(amount_minor) AS total
       FROM bank_transactions WHERE business_id = ? AND currency = 'ILS' AND amount_minor < 0 AND booked_on BETWEEN ? AND ?
      GROUP BY month, category_main ORDER BY month, total DESC`,
    businessId,
    from,
    to,
  );
  const bankIn = await all<{ month: string; n: number; total: number }>(
    db,
    `SELECT strftime('%Y-%m', booked_on) AS month, COUNT(*) AS n, SUM(amount_minor) AS total
       FROM bank_transactions WHERE business_id = ? AND currency = 'ILS' AND amount_minor > 0 AND booked_on BETWEEN ? AND ? GROUP BY month`,
    businessId,
    from,
    to,
  );
  const gaps = await all<{ month: string; dir: string; n: number; total: number }>(
    db,
    `SELECT strftime('%Y-%m', booked_on) AS month, CASE WHEN amount_minor < 0 THEN 'out' ELSE 'in' END AS dir, COUNT(*) AS n, SUM(ABS(amount_minor)) AS total
       FROM bank_transactions WHERE business_id = ? AND currency = 'ILS' AND match_status = 'unmatched' AND booked_on BETWEEN ? AND ?
        AND (amount_minor < 0 OR kind = 'BANK')
      GROUP BY month, dir`,
    businessId,
    from,
    to,
  );
  const expenses = await all<{ month: string; n: number; total: number | null }>(
    db,
    `SELECT strftime('%Y-%m', document_date) AS month, COUNT(*) AS n, SUM(COALESCE(amount_ils_minor, CASE WHEN currency = 'ILS' THEN amount_minor END)) AS total
       FROM expenses WHERE business_id = ? AND status IN ('new', 'filed') AND document_date BETWEEN ? AND ? GROUP BY month`,
    businessId,
    from,
    to,
  );
  const receipts = await all<{ month: string; n: number; total: number | null }>(
    db,
    `SELECT strftime('%Y-%m', p.paid_on) AS month, COUNT(*) AS n, SUM(COALESCE(p.amount_ils_minor, CASE WHEN p.currency = 'ILS' THEN p.amount_minor END)) AS total
       FROM payments p JOIN documents d ON d.id = p.document_id
      WHERE d.business_id = ? AND d.status = 'final' AND p.paid_on BETWEEN ? AND ? GROUP BY month`,
    businessId,
    from,
    to,
  );

  const months = new Set([...bankOut, ...bankIn, ...gaps, ...expenses, ...receipts].map((r) => r.month));
  const out: BankVsBooksLine[] = [];
  for (const month of [...months].sort()) {
    for (const r of bankOut.filter((x) => x.month === month)) {
      out.push({ month, line: `Bank money out: ${categoryLabel(r.category) ?? 'No category'}`, count: r.n, ils: r.total });
    }
    const exp = expenses.find((x) => x.month === month);
    out.push({ month, line: 'Money out recorded as expenses', count: exp?.n ?? 0, ils: exp?.total ?? 0 });
    const inn = bankIn.find((x) => x.month === month);
    out.push({ month, line: 'Bank money in', count: inn?.n ?? 0, ils: inn?.total ?? 0 });
    const rec = receipts.find((x) => x.month === month);
    out.push({ month, line: 'Money in recorded as receipts', count: rec?.n ?? 0, ils: rec?.total ?? 0 });
    const gapOut = gaps.find((x) => x.month === month && x.dir === 'out');
    out.push({ month, line: 'Card and bank charges with no expense', count: gapOut?.n ?? 0, ils: gapOut?.total ?? 0, status: 'unmatched' });
    const gapIn = gaps.find((x) => x.month === month && x.dir === 'in');
    out.push({ month, line: 'Deposits with no receipt', count: gapIn?.n ?? 0, ils: gapIn?.total ?? 0, status: 'unmatched' });
  }
  return out;
}
