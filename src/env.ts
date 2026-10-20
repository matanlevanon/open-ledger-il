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
  /** R24: Gemini key for document reading, the alternative to ANTHROPIC_API_KEY. */
  GEMINI_API_KEY?: string;
  /** R24: "anthropic" or "gemini". Empty: whichever key is set, Anthropic first. */
  AI_PROVIDER?: string;
  /** R24: model names, so a model retirement needs no code change. Defaults in src/modules/ai. */
  ANTHROPIC_MODEL?: string;
  GEMINI_MODEL?: string;
  /** Anthropic identity-linked keys belong to a user and must name a workspace (wrkspc_...) on every call. */
  ANTHROPIC_WORKSPACE_ID?: string;
  /** R24: the installer's preselection for the first-run Business type step. Read only while setup is incomplete. */
  SETUP_BUSINESS_TYPE?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  /** Drive import without a service account: a Google API key that reads folders shared as "anyone with the link". Read only. */
  GOOGLE_API_KEY?: string;
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
  /** R12: AES-GCM key for stored ITA tokens. R40: also the Financy client secret, with its own additional data. */
  ITA_TOKEN_KEY?: string;
  /** R35: HMAC key the email gateway signs forwarded receipts with. Set by the installer. */
  INBOX_SECRET?: string;
  /** Unified file (מבנה אחיד) INI.TXT software fields (section 3.1): the software as registered with the Tax Authority. */
  SOFTWARE_NAME?: string;
  SOFTWARE_VERSION?: string;
  /** Update check: owner/name of the GitHub repo this Ledger comes from. Empty turns the check off. */
  UPDATE_REPO?: string;
  /** The Tax Authority's software registration number, 8 digits, once issued. Empty until then. */
  SOFTWARE_REGISTRATION_NUMBER?: string;
  /** Tax ID of the software producer. Empty means the business itself. */
  SOFTWARE_PRODUCER_VAT?: string;
  SOFTWARE_PRODUCER_NAME?: string;
  /** R26: "1" turns the Worker into the public demo (src/modules/demo). Empty in a normal Ledger. */
  DEMO_MODE?: string;
  /** R26: where the banner's "Get your own Ledger" goes. */
  DEMO_CTA_URL?: string;
  /** R26: the name in the gate's marketing consent text, and the product name on the gate. */
  DEMO_SENDER_NAME?: string;
  DEMO_PRODUCT_NAME?: string;
  /** R26: a version label stored with each consent. Change it when the consent text changes. */
  DEMO_CONSENT_VERSION?: string;
  /** R26: the marketing box text on the gate. Empty uses a neutral default that names DEMO_SENDER_NAME. */
  DEMO_CONSENT_TEXT_EN?: string;
  DEMO_CONSENT_TEXT_HE?: string;
  /** R26: caps per visitor per day, and per whole demo per day. Defaults in src/modules/demo/config.ts. */
  DEMO_CAP_DOCUMENTS?: string;
  DEMO_CAP_PDFS?: string;
  DEMO_CAP_UPLOADS?: string;
  DEMO_CAP_UPLOAD_MB?: string;
  DEMO_CAP_CONTRACTS?: string;
  DEMO_CAP_BUSINESSES?: string;
  DEMO_DAILY_PDF_CAP?: string;
  DEMO_DAILY_SANDBOX_CAP?: string;
  /** R26: the fake Tax Authority's answer delay in milliseconds. Default 2000. */
  DEMO_ITA_DELAY_MS?: string;
  /** R26: Cloudflare Turnstile on the gate. The site key is a variable, the secret a secret. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  /** R26: optional lead capture. Off unless both are set: each lead posts as JSON to the URL with X-Lead-Secret. */
  DEMO_LEAD_WEBHOOK_URL?: string;
  DEMO_LEAD_SECRET?: string;
  /** R26: emails allowed on /admin, behind a Cloudflare Access app on that path. */
  ADMIN_EMAILS?: string;
  /** R26: the reset Worker's POST /run and its shared secret, for "Reset sandboxes now". */
  DEMO_RESET_URL?: string;
  DEMO_RESET_SECRET?: string;
  /** R26: the contact the demo's privacy notice names, for deletion requests. */
  DEMO_PRIVACY_CONTACT?: string;
  /** R26, set per request by the demo guard, never configured: the business the demo outbox files an email under. */
  DEMO_BUSINESS_ID?: string;
}

export interface AppVariables {
  user: AuthUser;
  requestId: string;
  /** R26: set for a demo session. admin = the sample set opened from /admin. R29: sessionKey tags a visitor's own rows. */
  demo?: { sessionKey: string | null; admin: boolean; adminEmail: string | null };
}

/** Hono generic for every app and sub-router in the Worker. */
export interface AppEnv {
  Bindings: Env;
  Variables: AppVariables;
}
