import type { AuthUser } from './core/auth';

/** Worker bindings. Secrets are optional here because each run adds its own. */
export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS?: Fetcher;
  ENVIRONMENT: string;
  ITA_ENV: 'sandbox' | 'production';
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  OWNER_EMAIL?: string;
  DEV_AUTH_EMAIL?: string;
  OWNER_TAX_ID?: string;
  SIGNING_KEY_PEM?: string;
  SIGNING_CERT_PEM?: string;
  /** Cloudflare Browser Rendering, used by src/modules/pdf to render documents to PDF (R02). */
  BROWSER?: Fetcher;
  SLACK_WEBHOOK_URL?: string;
  DOWNLOAD_SIGN_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  /** Outgoing email (R06), Resend API key. */
  MAIL_API_KEY?: string;
  /** Sender for outgoing email, for example "Sample Business Ltd <billing@example.com>". A domain verified in Resend. */
  MAIL_FROM?: string;
  /** HMAC key for signed consent and WhatsApp share links (R06). */
  SEND_LINK_KEY?: string;
  /** Public origin used to build links in emails, e.g. "https://ledger.example.com". Falls back to the request origin. */
  PUBLIC_APP_URL?: string;
  /** R14: quarterly backup exports and manifests. */
  BACKUPS: R2Bucket;
  /** R14: bearer token for POST /mcp. */
  MCP_TOKEN?: string;
}

export interface AppVariables {
  user: AuthUser;
  requestId: string;
}

/** Hono generic for every app and sub-router in the Worker. */
export interface AppEnv {
  Bindings: Env;
  Variables: AppVariables;
}
