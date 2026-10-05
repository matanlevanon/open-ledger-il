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

// Sandbox hosts come from the portal's OpenAPI files (specs/israel-invoices/openapi-sandbox):
// authorize on openapi.taxes.gov.il, token and API calls on t-ita-api.taxes.gov.il.
// Production is unverified until the production portal publishes its files.
export const ITA_URLS: Record<ItaEnvironment, ItaUrls> = {
  sandbox: {
    authorize: 'https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/authorize',
    token: 'https://t-ita-api.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/token',
    api: 'https://t-ita-api.taxes.gov.il/shaam/tsandbox/',
  },
  production: {
    authorize: 'https://ita-api.taxes.gov.il/shaam/production/longtimetoken/oauth2/authorize',
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

/** The literal OAuth2 scope the ITA expects. */
export const ITA_SCOPE = 'scope';

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
