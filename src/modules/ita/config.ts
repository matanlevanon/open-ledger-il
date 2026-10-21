import { demoItaFetch } from '../demo/ita-fake';
import { ConfigError } from '../../core/errors';
import type { Env } from '../../env';

/**
 * ITA endpoints and credentials. The environment comes only from the ITA_ENV Worker variable,
 * and each environment reads its own secret names, so sandbox and production never mix
 * (CLAUDE.md rule 7). Hosts and paths follow docs/israel-invoices-api.md and the v2 specs.
 */

export type ItaEnvironment = 'sandbox' | 'production';

export interface ItaUrls {
  authorize: string;
  token: string;
  /** Base for every API path, with a trailing slash. */
  api: string;
}

// SHAAM's address change notice of 18.12.2023. Sandbox: /authorize stays on openapi.taxes.gov.il,
// every other call moved to ita-api.taxes.gov.il. Production follows the same split: on 2026-10-08
// the production token call to openapi.taxes.gov.il timed out from the Israeli relay on every try.
// The portal's OpenAPI files also list t-ita-api.taxes.gov.il, which has no public DNS record.
export const ITA_URLS: Record<ItaEnvironment, ItaUrls> = {
  sandbox: {
    authorize: 'https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/authorize',
    token: 'https://ita-api.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/token',
    api: 'https://ita-api.taxes.gov.il/shaam/tsandbox/',
  },
  production: {
    authorize: 'https://openapi.taxes.gov.il/shaam/production/longtimetoken/oauth2/authorize',
    token: 'https://ita-api.taxes.gov.il/shaam/production/longtimetoken/oauth2/token',
    api: 'https://ita-api.taxes.gov.il/shaam/production/',
  },
};

/** API paths, appended to `ITA_URLS[env].api`. */
export const ITA_PATHS = {
  approval: 'Invoices/v2/Approval',
  multiApproval: 'Multi-invoices/v2/MultiApproval',
  // Confirmed in the portal's OpenAPI file invoicedecisionapi_v1.json.
  decisionCancel: 'InvoiceDecisionApi/v1/Cancel',
  decisionContinue: 'InvoiceDecisionApi/v1/Continue',
  decisionFurtherObjection: 'InvoiceDecisionApi/v1/FurtherObjection',
  details: 'invoice-information/v2/details',
  confirmationNumber: 'invoice-information/v2/confirmationNumber',
} as const;

export type ItaPath = (typeof ITA_PATHS)[keyof typeof ITA_PATHS];

/**
 * The OAuth2 scope for the invoice services. SHAAM's notice of 21.10.2026: from 01.11.2026 the
 * token call names the service family. Invoices, Multi-invoices, InvoiceDecisionApi and
 * invoice-information all use invoices_scope. The old literal "scope" works until that date only.
 */
export const ITA_SCOPE = 'invoices_scope';
/** The scope before 01.11.2026. A refresh token issued under it may still need it until then. */
export const ITA_LEGACY_SCOPE = 'scope';
/** The first day the ITA accepts only the new scope (Israel time). */
export const ITA_SCOPE_CUTOVER = '2026-11-01';

/** The scopes to try, in order, on a given day. The old one only before the cutover. */
export function itaScopes(now: Date): string[] {
  const israelDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return israelDay < ITA_SCOPE_CUTOVER ? [ITA_SCOPE, ITA_LEGACY_SCOPE] : [ITA_SCOPE];
}

/** ITA web app for manual allocation requests (fallback) and the hearing request portal. */
export const ITA_WEB_APP_URL = 'https://secapp.taxes.gov.il/em-hkz-hsb-intr';
export const ITA_SERVICE_PAGE_URL = 'https://www.gov.il/he/service/request-assignment-number-for-tax-invoice';

/** Customer VAT number for a client who does not deduct input VAT (ITA FAQ 55). */
export const NON_DEDUCTING_CUSTOMER_VAT = '999999998';

/** Worker secrets and variables the ITA module reads. Listed in docs/secrets.md. */
export interface ItaEnv extends Env {
  ITA_CLIENT_ID_SANDBOX?: string;
  ITA_CLIENT_SECRET_SANDBOX?: string;
  ITA_CLIENT_ID_PRODUCTION?: string;
  ITA_CLIENT_SECRET_PRODUCTION?: string;
  ITA_TOKEN_KEY?: string;
  /** The business VAT number (עוסק מורשה). Defaults to OWNER_TAX_ID, which is the same number for an individual. */
  ITA_VAT_NUMBER?: string;
  SLACK_WEBHOOK_URL?: string;
  /** Optional relay with an Israeli address, e.g. https://ita-relay.example.com. See relayedFetch. */
  ITA_RELAY_URL?: string;
  /** Cloudflare Access service token the relay accepts. Both are required when ITA_RELAY_URL is set. */
  ITA_RELAY_CLIENT_ID?: string;
  ITA_RELAY_CLIENT_SECRET?: string;
  /**
   * Optional login broker (tools/ita-auth) that holds a shared ITA API app's client secret.
   * When set, the Ledger needs no ITA client id or secret of its own. Name and key are the
   * ones the broker's operator issued for this install.
   */
  ITA_BROKER_URL?: string;
  ITA_BROKER_CLIENT?: string;
  ITA_BROKER_KEY?: string;
}

export interface ItaBroker {
  url: string;
  client: string;
  key: string;
}

/** The login broker settings, or null when ITA_BROKER_URL is not set. */
export function itaBroker(env: ItaEnv): ItaBroker | null {
  const url = (env.ITA_BROKER_URL ?? '').trim().replace(/\/+$/, '');
  if (!url) return null;
  const client = (env.ITA_BROKER_CLIENT ?? '').trim();
  const key = (env.ITA_BROKER_KEY ?? '').trim();
  if (!client || !key) throw new ConfigError('ITA_BROKER_URL is set. Set ITA_BROKER_CLIENT and ITA_BROKER_KEY too.');
  return { url, client, key };
}

/** Tax Authority hosts the relay forwards, by the path prefix it expects. */
const RELAY_HOSTS: Record<string, string> = {
  'openapi.taxes.gov.il': 'openapi',
  'ita-api.taxes.gov.il': 'ita-api',
};

/**
 * The fetch the ITA module uses for server-side calls (token, renewal, invoices).
 *
 * A Worker runs in whichever Cloudflare data center takes the request, often outside Israel,
 * and the Tax Authority refuses some of those calls with a bare 403. Three routes:
 *   1. ITA_BROKER_URL set: the login broker forwards the call (<broker>/ita/<openapi|ita-api>/...),
 *      with this install's broker name and key. The broker checks the install on every call and
 *      reaches the Tax Authority through its own relay. The relay settings here are ignored.
 *   2. ITA_RELAY_URL set: a relay with an Israeli address, with the Access service token headers.
 *   3. Neither: a direct call from wherever this Worker runs.
 * The browser sign-in (authorize) never passes here: it runs in the user's own browser.
 */
export function relayedFetch(env: ItaEnv, base: typeof fetch): typeof fetch {
  // R26: every ITA server call passes here. In demo mode the fake Tax Authority answers instead of the network.
  if ((env.DEMO_MODE ?? '').trim() === '1') return demoItaFetch(Number(env.DEMO_ITA_DELAY_MS ?? 2000));
  const broker = itaBroker(env);
  if (broker) {
    return (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const prefix = RELAY_HOSTS[url.hostname];
      if (!prefix) return base(input, init);
      const headers = new Headers(init?.headers);
      headers.set('X-Ita-Client', broker.client);
      headers.set('X-Ita-Client-Key', broker.key);
      return base(`${broker.url}/ita/${prefix}${url.pathname}${url.search}`, { ...init, headers });
    };
  }
  const relay = (env.ITA_RELAY_URL ?? '').trim().replace(/\/+$/, '');
  if (!relay) return base;
  const id = (env.ITA_RELAY_CLIENT_ID ?? '').trim();
  const secret = (env.ITA_RELAY_CLIENT_SECRET ?? '').trim();
  if (!id || !secret) throw new ConfigError('ITA_RELAY_URL is set. Set ITA_RELAY_CLIENT_ID and ITA_RELAY_CLIENT_SECRET too.');
  return (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const prefix = RELAY_HOSTS[url.hostname];
    if (!prefix) return base(input, init);
    const headers = new Headers(init?.headers);
    headers.set('CF-Access-Client-Id', id);
    headers.set('CF-Access-Client-Secret', secret);
    return base(`${relay}/${prefix}${url.pathname}${url.search}`, { ...init, headers });
  };
}

export function itaEnvironment(env: Env): ItaEnvironment {
  const value = (env.ITA_ENV ?? '').trim();
  if (value === 'sandbox' || value === 'production') return value;
  throw new ConfigError('ITA_ENV must be "sandbox" or "production".');
}

export interface ItaCredentials {
  environment: ItaEnvironment;
  clientId: string;
  clientSecret: string;
}

export function itaCredentials(env: ItaEnv): ItaCredentials {
  const environment = itaEnvironment(env);
  const clientId = environment === 'production' ? env.ITA_CLIENT_ID_PRODUCTION : env.ITA_CLIENT_ID_SANDBOX;
  const clientSecret = environment === 'production' ? env.ITA_CLIENT_SECRET_PRODUCTION : env.ITA_CLIENT_SECRET_SANDBOX;
  const suffix = environment.toUpperCase();
  if (!clientId) throw new ConfigError(`Set the ITA_CLIENT_ID_${suffix} secret.`);
  if (!clientSecret) throw new ConfigError(`Set the ITA_CLIENT_SECRET_${suffix} secret.`);
  return { environment, clientId, clientSecret };
}

/**
 * Manual mode: no ITA API app for the current environment (its client id or secret is not set).
 * The Ledger then never calls the ITA. An invoice that needs an allocation number waits on the
 * ITA screen until the number is requested in the ITA web app and typed in.
 */
export function itaManualMode(env: ItaEnv): boolean {
  // A login broker holds the app's credentials, so this install calls the ITA without its own.
  if ((env.ITA_BROKER_URL ?? '').trim()) return false;
  try {
    itaCredentials(env);
    return false;
  } catch (err) {
    if (err instanceof ConfigError) return true;
    throw err;
  }
}

/** The dealer and operator numbers sent with every call. Values come only from secrets. */
export interface ItaIdentity {
  vatNumber: string;
  userId: string;
  accountingSoftwareNumber: string;
}

const NINE_DIGITS = /^\d{9}$/;

export function itaIdentity(env: ItaEnv): ItaIdentity {
  const userId = (env.OWNER_TAX_ID ?? '').trim();
  const vatNumber = (env.ITA_VAT_NUMBER ?? userId).trim();
  if (!NINE_DIGITS.test(userId)) throw new ConfigError('Set the OWNER_TAX_ID secret to a 9-digit ID number.');
  if (!NINE_DIGITS.test(vatNumber)) throw new ConfigError('Set the ITA_VAT_NUMBER secret to a 9-digit VAT number.');
  // No software registration certificate: the spec asks for the producer's own ID or company number.
  return { vatNumber, userId, accountingSoftwareNumber: vatNumber };
}
