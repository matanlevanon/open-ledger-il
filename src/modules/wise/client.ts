import { DomainError } from '../../core/errors';

/**
 * R49: the Wise API, read only, with a personal API token of a Wise Business account
 * (docs.wise.com/guides/developer/auth-and-security/personal-api-token). Four calls: the profiles,
 * the balances of the business profile, a balance statement, and the profile's webhook
 * subscriptions. Nothing here moves money: no quote, recipient or transfer call exists.
 *
 * Wise documents its endpoints under a dated version (2026Q4). The numbered paths (v1 to v4) are
 * the same endpoints under their older names. Each call tries the dated path first and falls back
 * to the numbered one on a 404, so a token on either generation of the API works.
 */

export const WISE_API = 'https://api.wise.com';
export const WISE_VERSION = '2026Q4';

/** The plain messages the owner sees. */
export const WISE_MESSAGES = {
  wise_auth: 'Wise refused this token. Make a new one in Wise: Settings > Integrations and tools > API tokens.',
  wise_statement:
    'Wise did not allow reading statements with this token. Statements by API token work for Wise accounts based in the US, Canada, Australia, New Zealand, Singapore and Malaysia.',
  wise_busy: 'Wise asked the Ledger to slow down. Try again in a few minutes.',
  wise_no_business: 'This token has no Wise Business profile. Make the token while the business account is selected in Wise.',
} as const;

export class WiseError extends DomainError {}

function errorFor(code: keyof typeof WISE_MESSAGES): WiseError {
  return new WiseError(code, WISE_MESSAGES[code], code === 'wise_busy' ? 429 : 409);
}

export interface WiseMoney {
  value?: number | string | null;
  currency?: string | null;
}

export interface WiseProfile {
  id?: number;
  type?: string;
  fullName?: string | null;
  businessName?: string | null;
}

export interface WiseBalance {
  id?: number;
  currency?: string;
  type?: string;
  name?: string | null;
  amount?: WiseMoney | null;
}

export interface WiseStatementRow {
  type?: string;
  date?: string;
  amount?: WiseMoney | null;
  totalFees?: WiseMoney | null;
  details?: {
    type?: string | null;
    description?: string | null;
    senderName?: string | null;
    senderAccount?: string | null;
    paymentReference?: string | null;
    category?: string | null;
    merchant?: { name?: string | null } | null;
    recipient?: { name?: string | null } | null;
  } | null;
  runningBalance?: WiseMoney | null;
  referenceNumber?: string | null;
}

export interface WiseSubscription {
  id?: string;
  name?: string;
  trigger_on?: string;
  delivery?: { version?: string; url?: string } | null;
}

/** The event the webhook listens for, and its newest schema. */
export const WISE_EVENT = 'balances#update';
export const WISE_EVENT_VERSION = '4.0.0';
/** The older deposit-only event. A webhook made by hand in Wise may carry it, so the hook reads both. */
export const WISE_DEPOSIT_EVENT = 'balances#credit';

export class WiseClient {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch,
  ) {}

  /** One call. `paths` are tried in order, the next one only after a 404. */
  private async call(paths: string[], init: { method?: string; body?: unknown } = {}, statement = false): Promise<unknown> {
    let res: Response | null = null;
    for (const path of paths) {
      res = await this.fetcher(`${WISE_API}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      if (res.status !== 404) break;
    }
    if (!res) throw new WiseError('wise_error', 'Wise did not answer.', 502);
    if (res.status === 401) throw errorFor('wise_auth');
    if (res.status === 429) throw errorFor('wise_busy');
    // A statement refused with 403 is the extra approval Wise asks of accounts outside the listed countries.
    if (res.status === 403 && statement) throw errorFor('wise_statement');
    if (!res.ok) throw new WiseError('wise_error', `Wise answered ${res.status}.`, 502);
    if (res.status === 204) return null;
    const text = await res.text();
    try {
      return text ? (JSON.parse(text) as unknown) : null;
    } catch {
      throw new WiseError('wise_error', 'Wise sent an answer the Ledger could not read.', 502);
    }
  }

  async profiles(): Promise<WiseProfile[]> {
    const body = await this.call([`/${WISE_VERSION}/profiles`, '/v2/profiles']);
    return Array.isArray(body) ? (body as WiseProfile[]) : [];
  }

  async balances(profileId: number): Promise<WiseBalance[]> {
    const body = await this.call([`/${WISE_VERSION}/profiles/${profileId}/balances?types=STANDARD`, `/v4/profiles/${profileId}/balances?types=STANDARD`]);
    return Array.isArray(body) ? (body as WiseBalance[]).filter((b) => typeof b?.id === 'number' && typeof b?.currency === 'string') : [];
  }

  /** The rows of one balance between two instants, fees folded into their row (type COMPACT). */
  async statement(profileId: number, balanceId: number, currency: string, startIso: string, endIso: string): Promise<WiseStatementRow[]> {
    const query = `currency=${encodeURIComponent(currency)}&intervalStart=${encodeURIComponent(startIso)}&intervalEnd=${encodeURIComponent(endIso)}&type=COMPACT`;
    const tail = `/profiles/${profileId}/balance-statements/${balanceId}/statement.json?${query}`;
    const body = (await this.call([`/${WISE_VERSION}${tail}`, `/v1${tail}`], {}, true)) as { transactions?: WiseStatementRow[] } | null;
    return Array.isArray(body?.transactions) ? body.transactions : [];
  }

  async subscriptions(profileId: number): Promise<WiseSubscription[]> {
    const body = await this.call([`/${WISE_VERSION}/profiles/${profileId}/subscriptions`, `/v3/profiles/${profileId}/subscriptions`]);
    return Array.isArray(body) ? (body as WiseSubscription[]) : [];
  }

  async createSubscription(profileId: number, name: string, url: string): Promise<WiseSubscription> {
    const body = { name, trigger_on: WISE_EVENT, delivery: { version: WISE_EVENT_VERSION, url } };
    return ((await this.call([`/${WISE_VERSION}/profiles/${profileId}/subscriptions`, `/v3/profiles/${profileId}/subscriptions`], { method: 'POST', body })) ?? {}) as WiseSubscription;
  }

  async deleteSubscription(profileId: number, subscriptionId: string): Promise<void> {
    const id = encodeURIComponent(subscriptionId);
    await this.call([`/${WISE_VERSION}/profiles/${profileId}/subscriptions/${id}`, `/v3/profiles/${profileId}/subscriptions/${id}`], { method: 'DELETE' });
  }
}
