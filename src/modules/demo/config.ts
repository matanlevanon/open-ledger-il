import type { Env } from '../../env';
import { DEMO_SIGNING_CERT_PEM, DEMO_SIGNING_KEY_PEM } from './demo-cert';

/**
 * R26: demo mode. One Worker variable, DEMO_MODE=1, turns a Ledger into a public demo: the gate,
 * one shared read-only sample set with private visitor drafts (R29), the banner and watermark, a
 * fake Tax Authority, previews instead of issuing and sending, caps and the admin page. With DEMO_MODE unset, none of it runs. Names and texts come from variables, so
 * any Ledger can run its own demo.
 */

export function isDemo(env: Pick<Env, 'DEMO_MODE'>): boolean {
  return (env.DEMO_MODE ?? '').trim() === '1';
}

const num = (value: string | undefined, fallback: number) => {
  const n = Number((value ?? '').trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export interface DemoCaps {
  documents: number;
  pdfs: number;
  uploads: number;
  uploadBytes: number;
  contracts: number;
  businesses: number;
  dailyPdfs: number;
  dailySandboxes: number;
}

/** Per visitor session per day, and per whole demo per day. Variables override every default. */
export function demoCaps(env: Env): DemoCaps {
  return {
    documents: num(env.DEMO_CAP_DOCUMENTS, 50),
    pdfs: num(env.DEMO_CAP_PDFS, 30),
    uploads: num(env.DEMO_CAP_UPLOADS, 20),
    uploadBytes: num(env.DEMO_CAP_UPLOAD_MB, 2) * 1024 * 1024,
    contracts: num(env.DEMO_CAP_CONTRACTS, 10),
    businesses: num(env.DEMO_CAP_BUSINESSES, 3),
    dailyPdfs: num(env.DEMO_DAILY_PDF_CAP, 400),
    dailySandboxes: num(env.DEMO_DAILY_SANDBOX_CAP, 300),
  };
}

export interface DemoTexts {
  product: string;
  sender: string;
  ctaUrl: string;
  /** The version label stored with each consent. Change it whenever the consent text changes. */
  consentVersion: string;
  consentEn: string;
  consentHe: string;
}

export function demoTexts(env: Env): DemoTexts {
  const sender = (env.DEMO_SENDER_NAME ?? '').trim() || 'us';
  return {
    product: (env.DEMO_PRODUCT_NAME ?? '').trim() || 'Open Ledger IL',
    sender,
    ctaUrl: (env.DEMO_CTA_URL ?? '').trim() || '/',
    consentVersion: (env.DEMO_CONSENT_VERSION ?? '').trim() || '2026-10-13',
    consentEn: (env.DEMO_CONSENT_TEXT_EN ?? '').trim() || `Send me updates and offers from ${sender} by email. I can unsubscribe at any time.`,
    consentHe: (env.DEMO_CONSENT_TEXT_HE ?? '').trim() || `שלחו לי עדכונים והצעות מ-${sender} במייל. אפשר להסיר את עצמי בכל עת.`,
  };
}

/** The domain synthetic demo users sign in under. Nothing is ever sent to it. */
export const DEMO_USER_DOMAIN = 'sandbox.invalid';
export const MASTER_OWNER_EMAIL = `sample-owner@${DEMO_USER_DOMAIN}`;

/** Session cookie. R29: a visitor session ends after 30 idle minutes, the admin's after 24 hours. */
export const SESSION_COOKIE = 'ledger_demo';
export const SESSION_HOURS = 24;
export const SESSION_IDLE_MINUTES = 30;
/** A request refreshes the idle clock at most this often, so reads do not write on every call. */
export const SESSION_TOUCH_SECONDS = 60;

/** A fixed token key for the fake Tax Authority's tokens. They carry nothing. */
const DEMO_ITA_TOKEN_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256)));

const set = (v: string | undefined) => Boolean(v && v.trim());

/**
 * Demo mode refuses to start next to anything real: Tax Authority credentials, a relay or broker
 * key, or a signing certificate other than the bundled demo one. Returns the reason, or null.
 */
export function demoMisconfigured(env: Env & Record<string, unknown>): string | null {
  const ita = ['ITA_CLIENT_ID_SANDBOX', 'ITA_CLIENT_SECRET_SANDBOX', 'ITA_CLIENT_ID_PRODUCTION', 'ITA_CLIENT_SECRET_PRODUCTION', 'ITA_VAT_NUMBER'];
  // The demo's own fake values (demoEnv below) are allowed, so a demo env checks clean twice.
  const demoValues = new Set(['demo', '000000018']);
  for (const k of ita) if (set(env[k] as string | undefined) && !demoValues.has(String(env[k]).trim())) return `${k} is set. Demo mode never runs with Tax Authority credentials.`;
  for (const k of Object.keys(env)) {
    if (/^ITA_(RELAY|BROKER)_/.test(k) && set(env[k] as string | undefined)) return `${k} is set. Demo mode never runs with a relay or broker key.`;
  }
  if (set(env.SIGNING_CERT_PEM) && env.SIGNING_CERT_PEM!.trim() !== DEMO_SIGNING_CERT_PEM.trim()) return 'SIGNING_CERT_PEM is not the bundled demo certificate.';
  if (set(env.SIGNING_KEY_PEM) && env.SIGNING_KEY_PEM!.trim() !== DEMO_SIGNING_KEY_PEM.trim()) return 'SIGNING_KEY_PEM is not the bundled demo key.';
  return null;
}

/**
 * The bindings a demo request runs with: the demo certificate, the fake Tax Authority's
 * credentials, document reading off. Called once per request, never mutates the shared env.
 */
export function demoEnv(env: Env): Env {
  return {
    ...env,
    SIGNING_KEY_PEM: DEMO_SIGNING_KEY_PEM,
    SIGNING_CERT_PEM: DEMO_SIGNING_CERT_PEM,
    ITA_ENV: 'sandbox',
    ITA_CLIENT_ID_SANDBOX: 'demo',
    ITA_CLIENT_SECRET_SANDBOX: 'demo',
    ITA_TOKEN_KEY: DEMO_ITA_TOKEN_KEY,
    // A fake ID that passes the checksum and is not issued. Only the fake Tax Authority sees it.
    ITA_VAT_NUMBER: '000000018',
    OWNER_TAX_ID: '000000018',
    ANTHROPIC_API_KEY: undefined,
    GEMINI_API_KEY: undefined,
    GOOGLE_SERVICE_ACCOUNT_JSON: undefined,
    DEV_AUTH_EMAIL: undefined,
  } as Env;
}

/** Today in Israel, the day the caps and visits count by. */
export function demoDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
