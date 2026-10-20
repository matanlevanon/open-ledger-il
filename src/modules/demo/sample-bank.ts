import { all, run } from '../../core/db';
import { openDemands } from '../documents/balances';
import type { FinancyAccount, FinancyTransaction } from '../financy/client';
import { storeBankData } from '../financy/sync';

/**
 * R43: invented bank and card data for the demo's sample company, so visitors see the Financy
 * Dashboard and Bank activity. Nothing calls Financy: the rows go through the same store, flow
 * marks and matching as a real sync. Deposits answer some of the sample's open demands, so they
 * show as Suggested, and card charges answer the sample's expenses, so they show as Matched.
 * The connection row has no secret, and the daily sync skips the demo.
 */

const DAY = 24 * 60 * 60 * 1000;
const ago = (now: Date, days: number) => new Date(now.getTime() - days * DAY).toISOString().slice(0, 10);
const plus = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export const SAMPLE_BANK_ACCOUNTS: FinancyAccount[] = [
  { id: 'demo-chk', providerId: 'hapoalim', accountType: 'CHECKING', accountName: 'Business current account', accountNumber: '12-600-111222', currency: 'ILS',
    balances: [{ balanceType: 'closingBooked', balanceAmount: { amount: 48230.4, currency: 'ILS' } }] },
  { id: 'demo-fx', providerId: 'hapoalim', accountType: 'CHECKING', accountName: 'Foreign currency account', accountNumber: '12-600-111333', currency: 'ILY',
    balances: [{ balanceType: 'closingBooked', balanceAmount: { amount: 6120, currency: 'USD' } }, { balanceType: 'closingBooked', balanceAmount: { amount: 850, currency: 'EUR' } }] },
  { id: 'demo-isra', providerId: 'isracard', accountType: 'CARD', accountName: 'Business card', accountNumber: '532610xxxxxx4821', currency: 'ILS',
    balances: [{ balanceType: 'interimBooked', balanceAmount: { amount: -2486.3, currency: 'ILS' } }, { balanceType: 'closingBooked', balanceAmount: { amount: -2310, currency: 'ILS' } }],
    creditLimit: { amount: 25000, currency: 'ILS' }, cardDueDate: '2' },
  { id: 'demo-max', providerId: 'max', accountType: 'CARD', accountName: 'Max business', accountNumber: '458012xxxxxx7730', currency: 'ILS',
    balances: [{ balanceType: 'interimBooked', balanceAmount: { amount: -412, currency: 'ILS' } }], details: 'debitDay:10' },
];

export async function sampleBankTransactions(db: D1Database, businessId: number, now: Date): Promise<FinancyTransaction[]> {
  const out: FinancyTransaction[] = [];
  let n = 0;
  const bank = (date: string, amount: number, desc: string, main: string | null, account = 'demo-chk', currency = 'ILS', who: Partial<FinancyTransaction> = {}) => {
    n += 1;
    out.push({ id: `demo-tx-${n}`, accountId: account, amount: { chargedAmount: { amount, currency }, originalAmount: { amount, currency } }, description: { description: desc },
      category: main ? { main, sub: null } : null, date: { transactionDate: null, bookingDate: date, valueDate: date }, ...who });
  };
  const card = (date: string, amount: number, merchant: string, main: string, account = 'demo-isra', original?: { amount: number; currency: string }) => {
    n += 1;
    out.push({ id: `demo-tx-${n}`, accountId: account, amount: { chargedAmount: { amount, currency: 'ILS' }, originalAmount: original ?? { amount, currency: 'ILS' } },
      description: { description: merchant }, merchantName: merchant, category: { main, sub: null }, date: { transactionDate: date, bookingDate: plus(date, 12), valueDate: plus(date, 12) } });
  };
  const today = ago(now, 0);
  const inRange = (date: string, from: string) => date >= from && date <= today;
  const from = ago(now, 88);

  // Deposits that answer open demands: they show as Suggested, one click from a recorded payment.
  const demands = (await openDemands(db, businessId)).filter((d) => d.currency === 'ILS' && d.remaining_minor > 0 && inRange(plus(d.date, 3), from)).slice(0, 3);
  for (const d of demands) {
    const client = await all<{ name: string | null }>(db, 'SELECT COALESCE(NULLIF(name_en, \'\'), name_he) AS name FROM clients WHERE id = ?', d.client_id ?? 0);
    const name = client[0]?.name ?? 'client';
    bank(plus(d.date, 3), d.remaining_minor / 100, `Transfer ${name}`, 'DEPOSIT', 'demo-chk', 'ILS', { debtorName: name });
  }
  // A deposit with no document yet, and a client paying in dollars.
  bank(ago(now, 14), 2950, 'Transfer Northwind Media', 'DEPOSIT', 'demo-chk', 'ILS', { debtorName: 'Northwind Media' });
  bank(ago(now, 57), 3000, 'SWIFT Global Apps LLC', 'DEPOSIT', 'demo-fx', 'USD', { debtorName: 'Global Apps LLC' });

  // Charges that answer the sample's expenses: they show as Matched.
  const expenses = await all<{ document_date: string; amount_minor: number; currency: string; amount_ils_minor: number | null; supplier: string | null }>(
    db,
    `SELECT e.document_date, e.amount_minor, e.currency, e.amount_ils_minor, s.name AS supplier FROM expenses e LEFT JOIN suppliers s ON s.id = e.supplier_id
      WHERE e.business_id = ? AND e.demo_session_id IS NULL AND e.document_date IS NOT NULL AND e.amount_minor > 0`,
    businessId,
  );
  for (const e of expenses.filter((x) => inRange(x.document_date, from))) {
    const name = e.supplier ?? 'Supplier';
    if (e.currency === 'ILS') bank(e.document_date, -e.amount_minor / 100, `Standing order ${name}`, 'HOUSEHOLD_&_SERVICES', 'demo-chk', 'ILS', { creditorName: name });
    else card(e.document_date, -Math.round((e.amount_ils_minor ?? e.amount_minor * 3.65)) / 100, name, 'SHOPPING', 'demo-isra', { amount: -e.amount_minor / 100, currency: e.currency });
  }

  // Monthly rows: National Insurance and the bank fee to match by hand, card bills that are not counted twice.
  for (const m of [0, 1, 2]) {
    const base = 30 * m;
    if (base + 5 <= 88) bank(ago(now, base + 5), -1240, 'Bituach Leumi', 'NATIONAL_INSURANCE');
    if (base + 20 <= 88) bank(ago(now, base + 20), -18.5, 'Account fee', 'FINANCE');
    if (base + 18 <= 88) bank(ago(now, base + 18), -[2310, 1985.2, 2140.6][m]!, 'Isracard debit', 'FINANCE', 'demo-chk', 'ILS', { creditorName: 'Isracard' });
    if (base + 10 <= 88) bank(ago(now, base + 10), -[412, 640, 380][m]!, 'Max debit', 'FINANCE', 'demo-chk', 'ILS', { creditorName: 'Max' });
  }

  // Card charges to add as expenses.
  const charges: [number, number, string, string, string?][] = [
    [3, -146, 'City parking', 'TRANSPORT', 'demo-max'],
    [8, -265.4, 'Print House', 'SHOPPING'],
    [12, -188, 'Cafe Sample', 'LEISURE'],
    [19, -74.9, 'Domain Registrar', 'SHOPPING'],
    [24, -412, 'Fuel station', 'TRANSPORT', 'demo-max'],
    [32, -459, 'Design Fonts Ltd', 'SHOPPING'],
    [46, -96, 'Cafe Sample', 'LEISURE'],
    [53, -320, 'Fuel station', 'TRANSPORT', 'demo-max'],
    [61, -312.9, 'Paper & Co office supplies', 'SHOPPING'],
  ];
  for (const [d, amount, merchant, main, account] of charges) card(ago(now, d), amount, merchant, main, account ?? 'demo-isra');
  return out;
}

/** Builds the sample company's bank data. Runs once, while the master is built. */
export async function addMasterBank(db: D1Database, businessId: number, now: Date): Promise<void> {
  const ids = SAMPLE_BANK_ACCOUNTS.map((a) => a.id!);
  await run(
    db,
    `INSERT INTO financy_connection (business_id, client_id, client_secret_enc, secret_last4, user_id, status, account_ids, last_sync_at)
     VALUES (?, 'sample', NULL, NULL, 'sample', 'connected', ?, ?)`,
    businessId,
    JSON.stringify(ids),
    now.toISOString(),
  );
  const counts = await storeBankData(db, businessId, SAMPLE_BANK_ACCOUNTS, await sampleBankTransactions(db, businessId, now));
  await run(db, 'UPDATE financy_connection SET last_sync_result = ? WHERE business_id = ?', JSON.stringify(counts), businessId);
}
