import { FINANCY_API, type FinancyAccount, type FinancyTransaction } from './client';

/**
 * R40: an in-memory Financy behind a fake `fetch`, so tests run the real client: the token, the
 * paging, the 401 retry and the error answers. No test calls the internet (runs/_common.md).
 */

export const FAKE_CLIENT_ID = 'fake-client-id';
export const FAKE_CLIENT_SECRET = 'fake-secret-0123456789-abcd';
export const FAKE_USER_ID = 'fake-user-1';

export interface FakeFinancyOptions {
  /** Defaults: the live-data shapes below. */
  accounts?: FinancyAccount[];
  /** Defaults: 60 business transactions over two months before `today`, plus personal and loan rows. */
  transactions?: FinancyTransaction[];
  today?: string;
  /** Items per page, whatever limit is asked. */
  pageSize?: number;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Shaped like live Financy data (seen 20 Oct 2026): personal and business accounts together,
 * all marked "PRIV", loans and securities beside them, a checking account with several currencies,
 * masked card numbers, a due day as a string or only in `details`, and a blocked card.
 */
export function defaultAccounts(): FinancyAccount[] {
  const owner = { nationalId: '000000018', fullName: 'Test Owner Fullname' };
  return [
    {
      id: 'acc-checking',
      connectionId: 'conn-1',
      providerId: 'hapoalim',
      accountType: 'CHECKING',
      accountName: 'Business current account',
      accountNumber: '12-345-678901',
      parsedAccount: { bank: '12', branch: '345', number: '678901' },
      currency: 'ILS',
      usage: 'PRIV',
      balances: [
        { balanceType: 'closingBooked', balanceAmount: { amount: 15234.5, currency: 'ILS' }, creditLimitIncluded: false, referenceDate: '2026-10-19' },
        { balanceType: 'interimAvailable', balanceAmount: { amount: 24100.25, currency: 'ILS' }, creditLimitIncluded: true },
        { balanceType: 'interimAvailable', balanceAmount: { amount: 14100.25, currency: 'ILS' }, creditLimitIncluded: false },
        { balanceType: 'forwardAvailable', balanceAmount: { amount: 13000, currency: 'ILS' }, creditLimitIncluded: false },
      ],
      ownerInfo: owner,
    },
    {
      id: 'acc-fx',
      connectionId: 'conn-1',
      providerId: 'hapoalim',
      accountType: 'CHECKING',
      accountName: 'Foreign currency account',
      accountNumber: '12-345-990011',
      currency: 'ILY',
      usage: 'PRIV',
      balances: [
        { balanceType: 'closingBooked', balanceAmount: { amount: 1200.5, currency: 'USD' }, creditLimitIncluded: false },
        { balanceType: 'closingBooked', balanceAmount: { amount: 300, currency: 'EUR' }, creditLimitIncluded: false },
      ],
      ownerInfo: owner,
    },
    {
      id: 'acc-card',
      connectionId: 'conn-2',
      providerId: 'isracard',
      accountType: 'CARD',
      accountName: 'Business card',
      accountNumber: '532610xxxxxx9012',
      currency: 'ILS',
      usage: 'PRIV',
      balances: [
        { balanceType: 'interimBooked', balanceAmount: { amount: -2310.4, currency: 'ILS' }, creditLimitIncluded: false },
        { balanceType: 'closingBooked', balanceAmount: { amount: -1980, currency: 'ILS' }, creditLimitIncluded: false },
      ],
      creditLimit: { amount: 20000, currency: 'ILS' },
      cardDueDate: '2',
      ownerInfo: owner,
    },
    {
      id: 'acc-card-max',
      connectionId: 'conn-3',
      providerId: 'max',
      accountType: 'CARD',
      accountName: 'Max business',
      accountNumber: '458012xxxxxx3344',
      currency: 'ILS',
      usage: 'PRIV',
      balances: [{ balanceType: 'interimBooked', balanceAmount: { amount: -500, currency: 'ILS' } }],
      details: 'debitDay:10',
      ownerInfo: owner,
    },
    {
      id: 'acc-card-blocked',
      connectionId: 'conn-4',
      providerId: 'cal',
      accountType: 'CARD',
      accountName: 'Old card',
      accountNumber: '400000xxxxxx1111',
      status: 'blocked',
      creditLimit: { amount: 1, currency: 'ILS' },
      details: 'מועד חיוב: 15',
      ownerInfo: owner,
    },
    {
      id: 'acc-personal',
      connectionId: 'conn-5',
      providerId: 'amex',
      accountType: 'CARD',
      accountName: 'Personal card',
      accountNumber: '377700xxxxxx0005',
      details: { text: 'Cycle date: 20' },
      balances: [{ balanceType: 'interimBooked', balanceAmount: { amount: -900, currency: 'ILS' } }],
      ownerInfo: owner,
    },
    { id: 'acc-savings', accountType: 'SAVINGS', accountName: 'Savings', currency: 'ILS', balances: [{ balanceType: 'closingBooked', balanceAmount: { amount: 50000, currency: 'ILS' } }] },
    { id: 'acc-loan', accountType: 'LOAN', accountName: 'Overdraft line', currency: 'ILS', balances: [{ balanceType: 'closingBooked', balanceAmount: { amount: -10000, currency: 'ILS' } }] },
    { id: 'acc-securities', accountType: 'SECURITIES', accountName: 'Portfolio', currency: 'ILS', balances: [{ balanceType: 'closingBooked', balanceAmount: { amount: 80000, currency: 'ILS' } }] },
  ];
}

const CARD_CATEGORIES = ['SHOPPING', 'LEISURE', 'TRANSPORT', 'HEALTH_&_BEAUTY', null];

/**
 * 60 business transactions, one a day back from `today`: card charges with a transactionDate and a
 * merchant, bank rows with transactionDate null and no merchant, and deposits on the bank account.
 * Then 10 rows on the personal card and 5 on the loan, which a sync must never store.
 */
export function defaultTransactions(today = new Date().toISOString().slice(0, 10)): FinancyTransaction[] {
  const out: FinancyTransaction[] = [];
  for (let i = 0; i < 60; i += 1) {
    const date = addDays(today, -i);
    const deposit = i % 10 === 5;
    const card = i % 3 !== 0 && !deposit;
    const amount = deposit ? 1000 + i : -(10 + i + 0.5);
    const category = deposit
      ? i % 20 === 5
        ? { main: 'TRANSFER', sub: 'BIT_PAYBOX' }
        : { main: 'DEPOSIT', sub: null }
      : card
        ? { main: CARD_CATEGORIES[i % 5] ?? null, sub: null }
        : { main: 'FINANCE', sub: null };
    out.push({
      id: `tx-${String(i).padStart(3, '0')}`,
      accountId: card ? 'acc-card' : 'acc-checking',
      connectionId: card ? 'conn-2' : 'conn-1',
      type: 'NORMAL',
      amount: { chargedAmount: { amount, currency: 'ILS' }, originalAmount: { amount, currency: 'ILS' } },
      description: { description: deposit ? `Transfer from client ${i}` : card ? `Purchase ${i}` : `Bank fee ${i}`, additionalInfo: 'x'.repeat(300) },
      merchantName: card ? `Merchant ${i}` : null,
      creditorName: !card && !deposit ? 'Bank Hapoalim' : null,
      debtorName: deposit ? `Client ${i}` : null,
      category: category.main ? category : null,
      date: card ? { transactionDate: date, bookingDate: addDays(date, 20), valueDate: addDays(date, 20) } : { transactionDate: null, bookingDate: date, valueDate: date },
      isDuplicate: false,
    });
  }
  for (let i = 0; i < 10; i += 1) {
    const date = addDays(today, -i);
    out.push({
      id: `px-${i}`,
      accountId: 'acc-personal',
      type: 'NORMAL',
      amount: { chargedAmount: { amount: -(100 + i), currency: 'ILS' } },
      description: { description: `Personal ${i}` },
      merchantName: `Personal shop ${i}`,
      date: { transactionDate: date, bookingDate: date },
    });
  }
  for (let i = 0; i < 5; i += 1) {
    out.push({ id: `loan-${i}`, accountId: 'acc-loan', amount: { chargedAmount: { amount: -1000, currency: 'ILS' } }, date: { bookingDate: addDays(today, -i) } });
  }
  return out;
}

export class FakeFinancy {
  accounts: FinancyAccount[];
  transactions: FinancyTransaction[];
  pageSize: number;
  /** 'plan': data calls answer 403 NOT_AVAILABLE_ON_PLAN. 'auth': the token call answers 401. 'busy': data calls answer 429. */
  mode: 'ok' | 'plan' | 'auth' | 'busy' = 'ok';
  /** The next data call answers 401 once, as an expired token would. */
  expireNextCall = false;
  tokensIssued = 0;
  calls: string[] = [];
  credentials = { clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET, userId: FAKE_USER_ID };
  private validTokens = new Set<string>();

  constructor(options: FakeFinancyOptions = {}) {
    this.accounts = options.accounts ?? defaultAccounts();
    this.transactions = options.transactions ?? defaultTransactions(options.today);
    this.pageSize = options.pageSize ?? 25;
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    if (url.origin !== FINANCY_API) throw new Error(`FakeFinancy got a call to ${url.origin}`);
    this.calls.push(url.pathname);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (url.pathname === '/oauth/token') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { clientId?: string; clientSecret?: string; userId?: string };
      const ok = body.clientId === this.credentials.clientId && body.clientSecret === this.credentials.clientSecret && body.userId === this.credentials.userId;
      if (this.mode === 'auth' || !ok) return json(401, { error: 'invalid_client' });
      this.tokensIssued += 1;
      const token = `token-${this.tokensIssued}`;
      this.validTokens.add(token);
      return json(200, { accessToken: token, tokenType: 'Bearer', expiresIn: 86400 });
    }

    const auth = new Headers(init?.headers).get('authorization') ?? '';
    const token = auth.replace(/^Bearer /, '');
    if (this.expireNextCall) {
      this.expireNextCall = false;
      this.validTokens.delete(token);
    }
    if (!this.validTokens.has(token)) return json(401, { error: 'unauthorized' });
    if (this.mode === 'plan') return json(403, { code: 'NOT_AVAILABLE_ON_PLAN', message: 'Not available on your plan' });
    if (this.mode === 'busy') return json(429, { code: 'TOO_MANY_REQUESTS' });

    const page = (items: unknown[]) => {
      const start = Number(url.searchParams.get('nextPage') ?? '0');
      const slice = items.slice(start, start + this.pageSize);
      const next = start + this.pageSize < items.length ? String(start + this.pageSize) : '';
      return json(200, { nextPage: next, items: slice });
    };
    if (url.pathname === '/v2/data/accounts') return page(this.accounts);
    if (url.pathname === '/v2/data/transactions') {
      const from = url.searchParams.get('dateFrom') ?? '0000-00-00';
      const to = url.searchParams.get('dateTo') ?? '9999-99-99';
      const account = url.searchParams.get('accountId');
      return page(
        this.transactions.filter((t) => {
          const d = t.date?.transactionDate ?? t.date?.bookingDate ?? '';
          return d >= from && d <= to && (!account || t.accountId === account);
        }),
      );
    }
    return json(404, { error: 'not_found' });
  };
}
