import { all, stmt, transaction } from '../../core/db';

/**
 * R42 task 3: do not count money twice. A checking row that pays a picked card's bill is the same
 * money as the card charges (`card_payment`). A transfer between two picked accounts is no money
 * at all (`own_transfer`, the R40 rule). Both stay out of income, expenses, categories, matching
 * and the Bank vs books report. "Count this" locks a row as normal, and the sync keeps it so.
 */

export const FLOWS = ['normal', 'own_transfer', 'card_payment'] as const;
export type Flow = (typeof FLOWS)[number];

/**
 * The Israeli card companies: the Financy provider ids seen or expected, and the names a bank row
 * uses for the card bill, in English and Hebrew. Latin names match as whole words.
 */
export const CARD_COMPANIES: readonly { key: string; providers: readonly string[]; names: readonly string[] }[] = [
  { key: 'isracard', providers: ['isracard'], names: ['isracard', 'ישראכרט'] },
  { key: 'max', providers: ['max', 'leumi-card', 'leumicard'], names: ['max', 'leumi card', 'leumicard', 'מקס', 'לאומי קארד'] },
  { key: 'cal', providers: ['cal', 'visa-cal', 'visacal'], names: ['cal', 'visa cal', 'כאל', 'ויזה כאל'] },
  { key: 'amex', providers: ['amex', 'american-express', 'americanexpress'], names: ['american express', 'amex', 'אמריקן אקספרס', 'אמקס'] },
  { key: 'diners', providers: ['diners'], names: ['diners', 'דיינרס'] },
];

/** A Financy category that names a card bill, if such a category shows up. */
const CARD_PAYMENT_CATEGORY = /CREDIT_?CARD|CARD_?PAYMENT/i;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function nameMatcher(name: string): RegExp {
  // Hebrew has no \b in JS regexes, so Hebrew names match as plain text. Latin names as whole words.
  return /[a-z]/i.test(name) ? new RegExp(`(^|[^a-z0-9])${escape(name)}([^a-z0-9]|$)`, 'i') : new RegExp(escape(name));
}

/** The card companies of the business's picked cards, by provider id. */
export function companiesOf(providerIds: (string | null)[]): typeof CARD_COMPANIES {
  const ids = providerIds.map((p) => (p ?? '').toLowerCase().replace(/[\s_]/g, '-'));
  return CARD_COMPANIES.filter((c) => ids.some((id) => c.providers.includes(id) || c.providers.some((p) => id.includes(p))));
}

/** Money out on a bank account that names one of these card companies, or a card-bill category. */
export function isCardPayment(
  row: { kind: string; amount_minor: number; description: string | null; merchant: string | null; category_main: string | null; category_sub: string | null },
  companies: typeof CARD_COMPANIES,
): boolean {
  if (row.kind !== 'BANK' || row.amount_minor >= 0) return false;
  if (CARD_PAYMENT_CATEGORY.test(row.category_main ?? '') || CARD_PAYMENT_CATEGORY.test(row.category_sub ?? '')) return true;
  const text = `${row.description ?? ''} ${row.merchant ?? ''}`;
  return companies.some((c) => c.names.some((n) => nameMatcher(n).test(text)));
}

interface FlowRow {
  id: number;
  account_financy_id: string | null;
  kind: string;
  booked_on: string;
  amount_minor: number;
  currency: string;
  description: string | null;
  merchant: string | null;
  category_main: string | null;
  category_sub: string | null;
  flow: Flow;
  flow_locked: number;
}

/** Sets `flow` on every row of the business. Locked rows stay normal. Returns how many rows changed. */
export async function classifyFlows(db: D1Database, businessId: number): Promise<number> {
  const rows = await all<FlowRow>(
    db,
    `SELECT id, account_financy_id, kind, booked_on, amount_minor, currency, description, merchant, category_main, category_sub, flow, flow_locked
       FROM bank_transactions WHERE business_id = ? ORDER BY booked_on, id`,
    businessId,
  );
  const cards = await all<{ provider_id: string | null }>(db, "SELECT provider_id FROM bank_accounts WHERE business_id = ? AND account_type = 'CARD'", businessId);
  const companies = companiesOf(cards.map((c) => c.provider_id));

  const next = new Map<number, Flow>(rows.map((r) => [r.id, 'normal']));
  // Transfers first: the same amount out and in, the same day and currency, on two picked accounts.
  const paired = new Set<number>();
  for (const out of rows) {
    if (out.amount_minor >= 0 || out.flow_locked || paired.has(out.id)) continue;
    const back = rows.find(
      (r) =>
        !r.flow_locked &&
        !paired.has(r.id) &&
        r.amount_minor === -out.amount_minor &&
        r.currency === out.currency &&
        r.booked_on === out.booked_on &&
        r.account_financy_id !== null &&
        r.account_financy_id !== out.account_financy_id,
    );
    if (!back) continue;
    paired.add(out.id);
    paired.add(back.id);
    next.set(out.id, 'own_transfer');
    next.set(back.id, 'own_transfer');
  }
  for (const r of rows) {
    if (r.flow_locked || paired.has(r.id)) continue;
    if (isCardPayment(r, companies)) next.set(r.id, 'card_payment');
  }

  const changes = rows.filter((r) => next.get(r.id) !== r.flow);
  for (let i = 0; i < changes.length; i += 50) {
    await transaction(
      db,
      changes.slice(i, i + 50).map((r) => stmt(db, "UPDATE bank_transactions SET flow = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", next.get(r.id)!, r.id)),
    );
  }
  return changes.length;
}
