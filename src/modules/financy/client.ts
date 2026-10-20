import { DomainError } from '../../core/errors';

/**
 * R40: the Financy REST API (docs-financy.open-finance.ai, read 20 Oct 2026). Read only: a token,
 * the accounts and the transactions. Bank connections are added inside Financy, never here.
 *
 * The access token has no refresh token. It is cached in memory for this isolate until 5 minutes
 * before it expires, and fetched again on expiry or on a 401 (the call is tried once more). Every
 * field of an answer is treated as optional. Secrets never appear in an error or a log line.
 */

export const FINANCY_API = 'https://api.open-finance.ai';
/** At most 5 pages a second. Financy does not document its rate limits. */
export const PAGE_GAP_MS = 200;
const PAGE_LIMIT = 100;
/** A sync never reads more than this many pages of one list. */
const MAX_PAGES = 200;

export interface FinancyCredentials {
  clientId: string;
  clientSecret: string;
  userId: string;
}

interface Money {
  amount?: number | string | null;
  currency?: string | null;
}

export interface FinancyAccount {
  id?: string;
  connectionId?: string;
  providerId?: string;
  accountType?: string;
  accountName?: string;
  accountNumber?: string;
  parsedAccount?: { bank?: string; branch?: string; number?: string } | null;
  currency?: string;
  balances?: { balanceType?: string; balanceAmount?: Money; creditLimitIncluded?: boolean; referenceDate?: string }[] | null;
  creditLimit?: Money | number | null;
  /** A full date, or a day of the month ("10"). Often missing, with the day only in `details`. */
  cardDueDate?: string | null;
  creditStatus?: string | null;
  /** "blocked" on a card that no longer works. */
  status?: string | null;
  /** Free text or an object, for example "מועד חיוב: 10", "debitDay:10", "Cycle date: 10". */
  details?: unknown;
  /** Live data shows "PRIV" on every account, business ones too. Not a filter. */
  usage?: string | null;
  ownerInfo?: unknown;
}

export interface FinancyTransaction {
  id?: string;
  SK?: string;
  accountId?: string;
  connectionId?: string;
  providerId?: string;
  type?: string;
  amount?: { chargedAmount?: Money; originalAmount?: Money } | null;
  description?: { description?: string | null; additionalInfo?: string | null } | null;
  merchantName?: string | null;
  creditorName?: string | null;
  debtorName?: string | null;
  category?: { main?: string | null; sub?: string | null } | null;
  changedCategory?: { main?: string | null; sub?: string | null } | null;
  installments?: { number?: number | null; total?: number | null } | null;
  date?: { transactionDate?: string | null; bookingDate?: string | null; valueDate?: string | null } | null;
  isDuplicate?: boolean;
}

/** The plain messages the owner sees. */
export const FINANCY_MESSAGES = {
  financy_plan: 'Your Financy plan has no API access. Starter or higher is needed.',
  financy_auth: 'Financy refused these details. Copy them again from Financy > Settings > API.',
  financy_busy: 'Financy asked the Ledger to slow down. Try again in a few minutes.',
} as const;

export class FinancyError extends DomainError {}

function errorFor(code: keyof typeof FINANCY_MESSAGES): FinancyError {
  return new FinancyError(code, FINANCY_MESSAGES[code], code === 'financy_busy' ? 429 : 409);
}

function unavailable(status: number): FinancyError {
  return new FinancyError('financy_error', `Financy did not answer as expected (HTTP ${status}). Try again later.`, 502);
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

/** Per isolate. Keyed by client and user id plus a hash of the secret, never the secret itself. */
const tokenCache = new Map<string, CachedToken>();

/** Tests start each case from an empty cache. */
export function clearFinancyTokenCache(): void {
  tokenCache.clear();
}

async function cacheKey(c: FinancyCredentials): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${c.clientId}\n${c.userId}\n${c.clientSecret}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class FinancyClient {
  constructor(
    private readonly creds: FinancyCredentials,
    private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
    private readonly pageGapMs = PAGE_GAP_MS,
  ) {}

  /** A cached token, or a new one. `force` skips the cache after a 401. */
  async token(force = false): Promise<string> {
    const key = await cacheKey(this.creds);
    const cached = tokenCache.get(key);
    if (!force && cached && cached.expiresAt - 5 * 60_000 > Date.now()) return cached.token;
    let res: Response;
    try {
      res = await this.fetchFn(`${FINANCY_API}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ clientId: this.creds.clientId, clientSecret: this.creds.clientSecret, userId: this.creds.userId }),
      });
    } catch {
      throw new FinancyError('financy_error', 'Financy could not be reached. Try again later.', 502);
    }
    if (res.status === 429) throw errorFor('financy_busy');
    if (res.status >= 400 && res.status < 500) throw errorFor('financy_auth');
    if (!res.ok) throw unavailable(res.status);
    const body = (await res.json().catch(() => null)) as { accessToken?: string; expiresIn?: number } | null;
    if (!body?.accessToken) throw unavailable(res.status);
    // expiresIn is in seconds (the docs show 86400). Missing: one hour.
    const seconds = typeof body.expiresIn === 'number' && body.expiresIn > 0 ? body.expiresIn : 3600;
    tokenCache.set(key, { token: body.accessToken, expiresAt: Date.now() + seconds * 1000 });
    return body.accessToken;
  }

  /** One GET with the token. A 401 gets a new token and one more try. */
  private async get(path: string, params: Record<string, string | undefined>): Promise<unknown> {
    const url = new URL(path, FINANCY_API);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
    for (let attempt = 1; ; attempt += 1) {
      const token = await this.token(attempt > 1);
      let res: Response;
      try {
        res = await this.fetchFn(url.toString(), { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
      } catch {
        throw new FinancyError('financy_error', 'Financy could not be reached. Try again later.', 502);
      }
      if (res.status === 401 && attempt === 1) {
        await res.body?.cancel();
        continue;
      }
      if (res.status === 401) throw errorFor('financy_auth');
      if (res.status === 429) throw errorFor('financy_busy');
      if (res.status === 403) {
        const text = await res.text().catch(() => '');
        throw /NOT_AVAILABLE_ON_PLAN/.test(text) ? errorFor('financy_plan') : errorFor('financy_auth');
      }
      if (!res.ok) throw unavailable(res.status);
      return res.json();
    }
  }

  /** Every item of a paged list. Pages are spaced, and the loop ends on an empty nextPage. */
  private async all<T>(path: string, params: Record<string, string | undefined>): Promise<T[]> {
    const items: T[] = [];
    let nextPage: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      if (page > 0 && this.pageGapMs > 0) await sleep(this.pageGapMs);
      const body = (await this.get(path, { ...params, limit: String(PAGE_LIMIT), nextPage })) as { items?: T[]; nextPage?: string | null } | null;
      items.push(...(body?.items ?? []));
      nextPage = body?.nextPage ?? undefined;
      if (!nextPage) break;
    }
    return items;
  }

  accounts(): Promise<FinancyAccount[]> {
    return this.all<FinancyAccount>('/v2/data/accounts', {});
  }

  /** Transactions between two dates, YYYY-MM-DD, duplicates left out by Financy. With `accountId`, that account only. */
  transactions(dateFrom: string, dateTo: string, accountId?: string): Promise<FinancyTransaction[]> {
    return this.all<FinancyTransaction>('/v2/data/transactions', { dateFrom, dateTo, accountId, includeDuplicates: '0' });
  }
}
