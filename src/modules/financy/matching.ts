import { all, stmt, transaction } from '../../core/db';
import { openDemands } from '../documents/balances';

/**
 * R40 task 5: match pulled bank rows to the books. Runs after every sync, on unmatched rows only.
 *
 * 1. A transfer between two of the owner's own accounts (same amount, opposite signs, same day,
 *    different accounts, both pulled) is ignored on both sides.
 * 2. Money out matches an expense not matched yet: the same total in the same currency (or the
 *    original amount for a foreign charge), dates 5 days apart at most. The closer date wins, then
 *    a supplier name that shares a word with the merchant. One bank row per expense.
 * 3. Money in on a bank account gets a suggested open payment request or transaction invoice with
 *    the same open amount and currency, dated 10 days before the deposit or later. Only a
 *    suggestion: the row stays unmatched and no payment is recorded.
 */

export const OUT_DAYS = 5;
export const IN_DAYS = 10;

interface TxRow {
  id: number;
  account_financy_id: string | null;
  kind: 'BANK' | 'CARD';
  booked_on: string;
  amount_minor: number;
  currency: string;
  original_amount_minor: number | null;
  original_currency: string | null;
  merchant: string | null;
  description: string | null;
  matched_document_id: number | null;
}

interface ExpenseCandidate {
  id: number;
  document_date: string | null;
  amount_minor: number;
  currency: string;
  supplier_name: string | null;
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / 86_400_000);
}

function words(text: string | null): Set<string> {
  return new Set(
    (text ?? '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 2 && !['ltd', 'inc', 'llc', 'בע"מ', 'בעמ', 'the'].includes(w)),
  );
}

export function sharesWord(a: string | null, b: string | null): boolean {
  const left = words(a);
  for (const w of words(b)) if (left.has(w)) return true;
  return false;
}

/** Matches the business's unmatched rows. Returns how many rows got an expense. */
export async function matchBankTransactions(db: D1Database, businessId: number): Promise<number> {
  const rows = await all<TxRow>(
    db,
    `SELECT id, account_financy_id, kind, booked_on, amount_minor, currency, original_amount_minor, original_currency, merchant, description, matched_document_id
       FROM bank_transactions WHERE business_id = ? AND match_status = 'unmatched' ORDER BY booked_on, id`,
    businessId,
  );
  const updates: D1PreparedStatement[] = [];

  // 1. Transfers between own accounts.
  const ignored = new Set<number>();
  for (const out of rows) {
    if (out.amount_minor >= 0 || ignored.has(out.id)) continue;
    const back = rows.find(
      (r) =>
        !ignored.has(r.id) &&
        r.amount_minor === -out.amount_minor &&
        r.currency === out.currency &&
        r.booked_on === out.booked_on &&
        r.account_financy_id !== null &&
        r.account_financy_id !== out.account_financy_id,
    );
    if (!back) continue;
    ignored.add(out.id);
    ignored.add(back.id);
  }
  for (const id of ignored) updates.push(stmt(db, "UPDATE bank_transactions SET match_status = 'ignored', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", id));
  const open = rows.filter((r) => !ignored.has(r.id));

  // 2. Money out to expenses.
  let matched = 0;
  const outs = open.filter((r) => r.amount_minor < 0);
  if (outs.length > 0) {
    const from = outs[0]!.booked_on;
    const to = outs[outs.length - 1]!.booked_on;
    const candidates = await all<ExpenseCandidate>(
      db,
      `SELECT e.id, e.document_date, e.amount_minor, e.currency, s.name AS supplier_name
         FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id
        WHERE e.business_id = ? AND e.status IN ('new', 'filed') AND e.amount_minor > 0 AND e.document_date IS NOT NULL
          AND e.document_date BETWEEN date(?, '-${OUT_DAYS} days') AND date(?, '+${OUT_DAYS} days')
          AND NOT EXISTS (SELECT 1 FROM bank_transactions b WHERE b.matched_expense_id = e.id)`,
      businessId,
      from,
      to,
    );
    const taken = new Set<number>();
    for (const tx of outs) {
      const day = dayNumber(tx.booked_on);
      const fits = candidates.filter((e) => {
        if (taken.has(e.id) || Math.abs(dayNumber(e.document_date!) - day) > OUT_DAYS) return false;
        const same = e.currency === tx.currency && e.amount_minor === -tx.amount_minor;
        const original = tx.original_amount_minor !== null && e.currency === tx.original_currency && e.amount_minor === Math.abs(tx.original_amount_minor);
        return same || original;
      });
      if (fits.length === 0) continue;
      fits.sort((a, b) => {
        const gap = Math.abs(dayNumber(a.document_date!) - day) - Math.abs(dayNumber(b.document_date!) - day);
        if (gap !== 0) return gap;
        const word = Number(sharesWord(b.supplier_name, tx.merchant ?? tx.description)) - Number(sharesWord(a.supplier_name, tx.merchant ?? tx.description));
        return word !== 0 ? word : a.id - b.id;
      });
      const pick = fits[0]!;
      taken.add(pick.id);
      matched += 1;
      updates.push(
        stmt(db, "UPDATE bank_transactions SET match_status = 'matched', matched_expense_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", pick.id, tx.id),
      );
    }
  }

  // 3. Money in: a suggested document only.
  const ins = open.filter((r) => r.amount_minor > 0 && r.kind === 'BANK' && r.matched_document_id === null);
  if (ins.length > 0) {
    const suggested = new Set(
      (await all<{ id: number }>(db, 'SELECT matched_document_id AS id FROM bank_transactions WHERE business_id = ? AND matched_document_id IS NOT NULL', businessId)).map((r) => r.id),
    );
    const demands = (await openDemands(db, businessId)).filter((d) => !suggested.has(d.id));
    for (const tx of ins) {
      const day = dayNumber(tx.booked_on);
      const fits = demands.filter(
        (d) => !suggested.has(d.id) && d.currency === tx.currency && d.remaining_minor === tx.amount_minor && day >= dayNumber(d.date) - IN_DAYS,
      );
      if (fits.length === 0) continue;
      fits.sort((a, b) => Math.abs(dayNumber(a.date) - day) - Math.abs(dayNumber(b.date) - day) || a.id - b.id);
      const pick = fits[0]!;
      suggested.add(pick.id);
      updates.push(stmt(db, "UPDATE bank_transactions SET matched_document_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", pick.id, tx.id));
    }
  }

  for (let i = 0; i < updates.length; i += 50) await transaction(db, updates.slice(i, i + 50));
  return matched;
}
