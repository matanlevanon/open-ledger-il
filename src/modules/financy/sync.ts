import { type AuditActor, auditStatement, systemActorFor } from '../../core/audit';
import { all, nowIso, stmt, todayIsrael, transaction } from '../../core/db';
import type { Env } from '../../env';
import { type FinancyAccount, FinancyError, type FinancyTransaction } from './client';
import { type FinancyDeps, type SyncCounts, clientFor, credentialsFor, loadConnection, pickedIds, toMinor } from './connection';
import { matchBankTransactions } from './matching';

/**
 * R40 task 2: pull the picked accounts and their transactions from Financy into `bank_accounts`
 * and `bank_transactions`, then match. One Financy user holds personal and business money
 * together, so only CHECKING and CARD accounts the owner picked (task 3b) are read or stored.
 * SECURITIES, LOAN and SAVINGS accounts are never stored. A row already matched, ignored or added
 * keeps its status. Owner names, national ids and full account numbers are never stored.
 */

export const DEFAULT_SYNC_DAYS = 35;
export const FIRST_SYNC_DAYS = 90;
/** The only account types the Ledger reads. */
export const BUSINESS_TYPES = ['CHECKING', 'CARD'] as const;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const text = (value: string | null | undefined, max: number) => (value?.trim() ? value.trim().slice(0, max) : null);
const day = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);

export const accountType = (a: FinancyAccount) => (a.accountType ?? '').toUpperCase();
export const isBusinessType = (a: FinancyAccount) => (BUSINESS_TYPES as readonly string[]).includes(accountType(a));
export const isBlocked = (a: FinancyAccount) => (a.status ?? '').toLowerCase() === 'blocked';

/** Card numbers come masked ("532610xxxxxx4568"). Only the last 4 digits are kept. */
export function last4(account: FinancyAccount): string | null {
  const digits = (account.parsedAccount?.number ?? account.accountNumber ?? '').replace(/\D/g, '');
  return digits ? digits.slice(-4) : null;
}

/**
 * The card's charge day: a full date, or a day of the month. Live data gives "10" in `cardDueDate`,
 * or nothing there and the day in `details` ("מועד חיוב: 10", "debitDay:10", "Cycle date: 10").
 */
export function cardDueDay(account: FinancyAccount): string | null {
  const raw = account.cardDueDate?.trim();
  if (raw) {
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    if (/^\d{1,2}$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 31) return String(Number(raw));
  }
  const details = typeof account.details === 'string' ? account.details : account.details ? JSON.stringify(account.details) : '';
  const hit = /(?:מועד\s*חיוב|debitDay|Cycle\s*date)\s*"?\s*[:=]\s*"?(\d{1,2})\b/i.exec(details);
  return hit && Number(hit[1]) >= 1 && Number(hit[1]) <= 31 ? String(Number(hit[1])) : null;
}

export interface CurrencyBalance {
  currency: string;
  balanceMinor: number;
  balanceType: string;
}

/**
 * One balance per currency. The currency comes from each balance entry, never from the account
 * (one live account says "ILY" and holds USD and EUR). Checking prefers what is available, a card
 * what it charged so far. Of two entries of one type, the one without the credit limit wins.
 */
export function accountBalances(account: FinancyAccount, preferred = accountType(account) === 'CARD' ? ['interimBooked', 'closingBooked'] : ['interimAvailable', 'closingBooked', 'interimBooked', 'expected', 'forwardAvailable']): CurrencyBalance[] {
  const entries = (account.balances ?? []).filter((b) => b && toMinor(b.balanceAmount?.amount) !== null);
  const currencies = [...new Set(entries.map((b) => (b.balanceAmount?.currency ?? account.currency ?? 'ILS').toUpperCase()))];
  const out: CurrencyBalance[] = [];
  for (const currency of currencies) {
    const mine = entries.filter((b) => (b.balanceAmount?.currency ?? account.currency ?? 'ILS').toUpperCase() === currency);
    for (const type of preferred) {
      const ofType = mine.filter((b) => b.balanceType === type);
      const pick = ofType.find((b) => b.creditLimitIncluded === false) ?? ofType.find((b) => b.creditLimitIncluded !== true) ?? ofType[0];
      if (pick) {
        out.push({ currency, balanceMinor: toMinor(pick.balanceAmount?.amount)!, balanceType: type });
        break;
      }
    }
  }
  // Shekels first, then the rest as they came.
  return out.sort((a, b) => Number(b.currency === 'ILS') - Number(a.currency === 'ILS'));
}

/** Kept for the single balance columns: the shekel balance, else the first. */
export function accountBalance(account: FinancyAccount): { minor: number | null; type: string | null; currency: string | null } {
  const first = accountBalances(account)[0];
  return first ? { minor: first.balanceMinor, type: first.balanceType, currency: first.currency } : { minor: null, type: null, currency: null };
}

function accountStatement(db: D1Database, businessId: number, a: FinancyAccount): D1PreparedStatement {
  const balances = accountBalances(a);
  const primary = balances[0] ?? null;
  const available = accountBalances(a, ['interimAvailable']).find((b) => b.currency === primary?.currency) ?? null;
  const limit = typeof a.creditLimit === 'object' && a.creditLimit !== null ? a.creditLimit.amount : a.creditLimit;
  return stmt(
    db,
    `INSERT INTO bank_accounts (business_id, financy_id, account_type, name, provider_id, masked_number, currency, balance_minor, balance_type, available_minor,
       credit_limit_minor, card_due_date, balances_json, blocked, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (business_id, financy_id) DO UPDATE SET account_type = excluded.account_type, name = excluded.name, provider_id = excluded.provider_id,
       masked_number = excluded.masked_number, currency = excluded.currency, balance_minor = excluded.balance_minor, balance_type = excluded.balance_type,
       available_minor = excluded.available_minor, credit_limit_minor = excluded.credit_limit_minor, card_due_date = excluded.card_due_date,
       balances_json = excluded.balances_json, blocked = excluded.blocked, updated_at = excluded.updated_at`,
    businessId,
    a.id!,
    accountType(a),
    text(a.accountName, 120),
    text(a.providerId, 80),
    last4(a),
    primary?.currency ?? (a.currency ?? 'ILS').toUpperCase(),
    primary?.balanceMinor ?? null,
    primary?.balanceType ?? null,
    available?.balanceMinor ?? null,
    toMinor(limit ?? null),
    accountType(a) === 'CARD' ? cardDueDay(a) : null,
    JSON.stringify(balances),
    isBlocked(a) ? 1 : 0,
    nowIso(),
  );
}

/** The bank row for one Financy transaction, or null when it has no id, date or amount. */
export function transactionValues(t: FinancyTransaction, cardAccounts: Set<string>) {
  const charged = t.amount?.chargedAmount;
  const original = t.amount?.originalAmount;
  const amount = toMinor(charged?.amount);
  // Card rows carry transactionDate. Bank rows come with transactionDate null and a bookingDate.
  const bookedOn = day(t.date?.transactionDate) ?? day(t.date?.bookingDate);
  if (!t.id || amount === null || !bookedOn) return null;
  const category = t.changedCategory?.main ? t.changedCategory : t.category;
  // The description, 200 characters at most. The additional info stands in only when there is no description.
  const description = text(t.description?.description, 200) ?? text(t.description?.additionalInfo, 200);
  return {
    financyId: t.id,
    accountId: t.accountId ?? null,
    kind: t.accountId && cardAccounts.has(t.accountId) ? 'CARD' : 'BANK',
    bookedOn,
    valueOn: day(t.date?.valueDate),
    amount,
    currency: (charged?.currency ?? 'ILS').toUpperCase(),
    originalAmount: toMinor(original?.amount),
    originalCurrency: original?.currency ? original.currency.toUpperCase() : null,
    description,
    // Most bank rows have no merchant. Screens fall back to the description, so the creditor or
    // debtor name stands in only when there is no description either.
    merchant: text(t.merchantName, 120) ?? (description ? null : text(t.creditorName ?? t.debtorName, 120)),
    categoryMain: text(category?.main, 80),
    categorySub: text(category?.sub, 80),
    installmentNumber: typeof t.installments?.number === 'number' ? t.installments.number : null,
    installmentTotal: typeof t.installments?.total === 'number' ? t.installments.total : null,
  };
}

function transactionStatement(db: D1Database, businessId: number, v: NonNullable<ReturnType<typeof transactionValues>>): D1PreparedStatement {
  // match_status, matched_expense_id and matched_document_id are never overwritten by a sync.
  return stmt(
    db,
    `INSERT INTO bank_transactions (business_id, financy_id, account_financy_id, kind, booked_on, value_on, amount_minor, currency, original_amount_minor, original_currency,
       description, merchant, category_main, category_sub, installment_number, installment_total, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (business_id, financy_id) DO UPDATE SET account_financy_id = excluded.account_financy_id, kind = excluded.kind, booked_on = excluded.booked_on,
       value_on = excluded.value_on, amount_minor = excluded.amount_minor, currency = excluded.currency, original_amount_minor = excluded.original_amount_minor,
       original_currency = excluded.original_currency, description = excluded.description, merchant = excluded.merchant, category_main = excluded.category_main,
       category_sub = excluded.category_sub, installment_number = excluded.installment_number, installment_total = excluded.installment_total, updated_at = excluded.updated_at`,
    businessId,
    v.financyId,
    v.accountId,
    v.kind,
    v.bookedOn,
    v.valueOn,
    v.amount,
    v.currency,
    v.originalAmount,
    v.originalCurrency,
    v.description,
    v.merchant,
    v.categoryMain,
    v.categorySub,
    v.installmentNumber,
    v.installmentTotal,
    nowIso(),
  );
}

async function inChunks(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < statements.length; i += 50) await transaction(db, statements.slice(i, i + 50));
}

/** The message stored on the connection. A Financy error is already plain, anything else gets a lead-in. */
export function syncErrorMessage(err: unknown): string {
  if (err instanceof FinancyError) return err.message;
  return `The sync failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
}

export const NOTHING_SYNCED: SyncCounts = { accounts: 0, transactions: 0, new: 0, matched: 0 };

/**
 * Pulls `days` back from today, for the picked accounts only. No account picked: nothing is asked
 * of Financy and nothing changes. On failure the connection goes to status error with the
 * message, and the error is thrown on to the caller.
 */
export async function syncFinancy(
  env: Env,
  deps: FinancyDeps,
  businessId: number,
  options: { days?: number; today?: string; actor?: AuditActor } = {},
): Promise<SyncCounts> {
  const row = await loadConnection(env.DB, businessId);
  if (!row || row.status === 'disconnected') throw new FinancyError('financy_not_connected', 'Financy is not connected.', 409);
  const picked = pickedIds(row);
  if (picked.length === 0) return NOTHING_SYNCED;
  const actor = options.actor ?? systemActorFor(businessId);
  const today = options.today ?? todayIsrael();
  try {
    const client = clientFor(await credentialsFor(env, row), deps);
    const accounts = (await client.accounts()).filter((a) => a.id && picked.includes(a.id) && isBusinessType(a));
    const cards = new Set(accounts.filter((a) => accountType(a) === 'CARD').map((a) => a.id!));
    const from = addDays(today, -(options.days ?? DEFAULT_SYNC_DAYS));
    const pulled: FinancyTransaction[] = [];
    for (const a of accounts) pulled.push(...(await client.transactions(from, today, a.id!)));
    const ids = new Set(accounts.map((a) => a.id!));
    // Financy filters by account. A row from any other account is still never stored.
    const values = pulled
      .filter((t) => !t.isDuplicate && t.accountId && ids.has(t.accountId))
      .map((t) => transactionValues(t, cards))
      .filter((v): v is NonNullable<typeof v> => v !== null);

    const known = new Set(
      (await all<{ financy_id: string }>(env.DB, 'SELECT financy_id FROM bank_transactions WHERE business_id = ?', businessId)).map((r) => r.financy_id),
    );
    const fresh = new Set(values.filter((v) => !known.has(v.financyId)).map((v) => v.financyId)).size;
    await inChunks(env.DB, [...accounts.map((a) => accountStatement(env.DB, businessId, a)), ...values.map((v) => transactionStatement(env.DB, businessId, v))]);
    const matched = await matchBankTransactions(env.DB, businessId);

    const counts: SyncCounts = { accounts: accounts.length, transactions: values.length, new: fresh, matched };
    await transaction(env.DB, [
      stmt(
        env.DB,
        "UPDATE financy_connection SET status = 'connected', last_error = NULL, last_sync_at = ?, last_sync_result = ?, updated_at = ? WHERE business_id = ?",
        nowIso(),
        JSON.stringify(counts),
        nowIso(),
        businessId,
      ),
      auditStatement(env.DB, actor, 'financy.sync', 'financy_connection', businessId, { ...counts, days: options.days ?? DEFAULT_SYNC_DAYS }),
    ]);
    return counts;
  } catch (err) {
    await env.DB.prepare("UPDATE financy_connection SET status = 'error', last_error = ?, updated_at = ? WHERE business_id = ?")
      .bind(syncErrorMessage(err), nowIso(), businessId)
      .run();
    throw err;
  }
}

/** R40: the daily sync of every connected business. Never throws: a failure stays on its connection. */
export async function syncAllDaily(env: Env, deps: FinancyDeps): Promise<{ synced: number; failed: number }> {
  const result = { synced: 0, failed: 0 };
  const rows = await all<{ business_id: number }>(env.DB, "SELECT business_id FROM financy_connection WHERE status = 'connected'");
  for (const { business_id } of rows) {
    try {
      await syncFinancy(env, deps, business_id, { days: DEFAULT_SYNC_DAYS });
      result.synced += 1;
    } catch (err) {
      result.failed += 1;
      console.error('financy.sync_failed', business_id, err instanceof FinancyError ? err.code : 'error');
    }
  }
  console.log('financy.sync_daily', result);
  return result;
}
