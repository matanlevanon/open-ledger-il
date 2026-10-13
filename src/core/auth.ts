import type { MiddlewareHandler } from 'hono';
import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppEnv, Env } from '../env';
import { SYSTEM_ACTOR, actorFrom, auditAs, auditStatement } from './audit';
import { all, first, stmt, todayIsrael, transaction } from './db';
import { ForbiddenError, UnauthorizedError } from './errors';
import { isDemo } from '../modules/demo/config';
import { sessionFromCookie } from '../modules/demo/session';

/**
 * Sign-in through Cloudflare Access.
 *
 * Access puts a signed JWT in the `Cf-Access-Jwt-Assertion` header. The Worker verifies it
 * against the team JWKS (`<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`), checks issuer and
 * audience, then maps the email to a `users` row. Unknown, inactive or expired users get 403.
 *
 * Dev bypass: when DEV_AUTH_EMAIL is set and ENVIRONMENT is not "production", a request
 * without the header signs in as that email. Production never bypasses.
 */

export type Role = 'owner' | 'assistant' | 'accountant';

/**
 * R24 Phase B (R23 task 6): an assistant issues and sends documents, keeps clients and expenses.
 * No Settings, numbering, users, legal-mode switch or ITA connection, no reports or exports.
 */
export const ASSISTANT_FEATURES = ['issue_documents', 'quotes', 'income_documents', 'clients', 'expenses', 'notes', 'business_documents', 'contracts'] as const;

/** Switches an owner can grant an accountant. Defaults from docs/accountant-access.md. */
export const DEFAULT_ACCOUNTANT_FEATURES = {
  income_documents: true,
  expenses: true,
  clients: true,
  reports: true,
  monthly_pack: true,
  unified_file: true,
  pcn874: true,
  bank_matches: false,
  // R24 Phase C: business certificates. Off until the owner turns it on.
  business_documents: false,
  // R25: signed contracts and work orders, view only. Off until the owner turns it on.
  contracts: false,
  notes: true,
} as const;

export type AccountantFeature = keyof typeof DEFAULT_ACCOUNTANT_FEATURES;
export const ACCOUNTANT_FEATURES = Object.keys(DEFAULT_ACCOUNTANT_FEATURES) as AccountantFeature[];

/** Areas an accountant never reaches, whatever the switches say. */
export const OWNER_ONLY_FEATURES = ['issue_documents', 'quotes', 'settings', 'numbering', 'ita', 'users'] as const;
export type OwnerOnlyFeature = (typeof OWNER_ONLY_FEATURES)[number];

export type Feature = AccountantFeature | OwnerOnlyFeature;
export const FEATURES: readonly Feature[] = [...ACCOUNTANT_FEATURES, ...OWNER_ONLY_FEATURES];

export type ThemePreference = 'light' | 'dark';
export type LocalePreference = 'en' | 'he';

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  role: Role;
  /** Enabled features. Owners hold every feature. */
  features: Feature[];
  /** R16 tasks 15/16: null until the person picks one; the client falls back to system/English. */
  theme: ThemePreference | null;
  locale: LocalePreference | null;
  /** R24: the business this request acts on. Every query is scoped by it. */
  businessId: number;
  /** R24: every business this person may open, with the role there. */
  businesses: { id: number; role: Role }[];
}

interface UserRow {
  id: number;
  email: string;
  name: string | null;
  role: Role;
  active: number;
  access_ends_on: string | null;
  theme: ThemePreference | null;
  locale: LocalePreference | null;
}

export interface AuthOptions {
  /** Key lookup for JWT verification. Tests pass a local JWKS. Default: the team's remote JWKS. */
  keyResolver?: (env: Env) => JWTVerifyGetKey;
  /** Clock for expiry checks. */
  today?: () => string;
}

const remoteJwks = new Map<string, JWTVerifyGetKey>();

function teamDomain(env: Env): string {
  return (env.ACCESS_TEAM_DOMAIN ?? '').trim().replace(/\/+$/, '');
}

function defaultKeyResolver(env: Env): JWTVerifyGetKey {
  const domain = teamDomain(env);
  let jwks = remoteJwks.get(domain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${domain}/cdn-cgi/access/certs`));
    remoteJwks.set(domain, jwks);
  }
  return jwks;
}

export function devBypassAllowed(env: Env): boolean {
  return Boolean(env.DEV_AUTH_EMAIL) && env.ENVIRONMENT !== 'production';
}

async function emailFromAccessJwt(token: string, env: Env, options: AuthOptions): Promise<string> {
  const domain = teamDomain(env);
  const audience = (env.ACCESS_AUD ?? '').trim();
  if (!domain || !audience) throw new UnauthorizedError('Sign-in is not configured.');
  try {
    const resolver = (options.keyResolver ?? defaultKeyResolver)(env);
    const { payload } = await jwtVerify(token, resolver, { issuer: domain, audience });
    if (typeof payload.email !== 'string' || !payload.email.includes('@')) {
      throw new UnauthorizedError('The sign-in token has no email.');
    }
    return payload.email.toLowerCase();
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError('The sign-in token is not valid.');
  }
}

async function loadFeatures(db: D1Database, user: UserRow, role: Role): Promise<Feature[]> {
  if (role === 'owner') return [...FEATURES];
  if (role === 'assistant') return [...ASSISTANT_FEATURES];
  const rows = await all<{ feature: string; enabled: number }>(
    db,
    'SELECT feature, enabled FROM user_features WHERE user_id = ?',
    user.id,
  );
  const set = new Map(rows.map((r) => [r.feature, r.enabled === 1]));
  return ACCOUNTANT_FEATURES.filter((f) => set.get(f) === true);
}

/** First sign-in of OWNER_EMAIL while no owner exists creates the owner row. */
async function bootstrapOwner(db: D1Database, env: Env, email: string): Promise<UserRow | null> {
  const ownerEmail = (env.OWNER_EMAIL ?? '').trim().toLowerCase();
  if (!ownerEmail || ownerEmail !== email) return null;
  await transaction(db, [
    stmt(
      db,
      `INSERT INTO users (email, role) SELECT ?, 'owner'
       WHERE NOT EXISTS (SELECT 1 FROM user_businesses WHERE role = 'owner') AND NOT EXISTS (SELECT 1 FROM users WHERE email = ?)`,
      email,
      email,
    ),
    // R24: the bootstrap owner owns business 1.
    stmt(
      db,
      `INSERT INTO user_businesses (user_id, business_id, role)
       SELECT id, 1, 'owner' FROM users WHERE email = ?
         AND NOT EXISTS (SELECT 1 FROM user_businesses WHERE role = 'owner')`,
      email,
    ),
    auditStatement(db, { ...SYSTEM_ACTOR, email }, 'user.bootstrap_owner', 'user', email),
  ]);
  return first<UserRow>(db, 'SELECT * FROM users WHERE email = ?', email);
}

/** Resolves the signed-in user and sets `c.get('user')`. Accountant requests are written to audit_log. */
export function authenticate(options: AuthOptions = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const env = c.env;
    const token = c.req.header('Cf-Access-Jwt-Assertion');
    let email: string;
    // R26: in demo mode the visitor's session cookie names a synthetic owner of their sandbox.
    const demo = isDemo(env) ? await sessionFromCookie(env.DB, c.req.header('Cookie')) : null;
    if (isDemo(env) && !demo) throw new UnauthorizedError('Open the demo from its start page.');
    if (demo) {
      email = demo.email;
      c.set('demo', { sandboxId: demo.sandboxId, admin: demo.admin, adminEmail: demo.adminEmail });
    } else if (token) {
      email = await emailFromAccessJwt(token, env, options);
    } else if (devBypassAllowed(env)) {
      email = env.DEV_AUTH_EMAIL!.trim().toLowerCase();
    } else {
      throw new UnauthorizedError();
    }

    let user = await first<UserRow>(env.DB, 'SELECT * FROM users WHERE email = ?', email);
    const grantsOf = (u: UserRow) => businessGrants(env.DB, u.id, (options.today ?? todayIsrael)());
    if (!user || (await grantsOf(user)).length === 0) user = (await bootstrapOwner(env.DB, env, email)) ?? user;
    if (!user) throw new ForbiddenError('This account has no access to Open Ledger IL.');
    if (user.active !== 1) throw new ForbiddenError('This account is disabled.');
    const today = (options.today ?? todayIsrael)();
    if (user.access_ends_on && user.access_ends_on < today) {
      throw new ForbiddenError('Access for this account has ended.');
    }

    // R24: the business comes from X-Business-Id, checked against this person's grants before
    // anything is read or written. Without the header, the first business they may open.
    const grants = await grantsOf(user);
    if (grants.length === 0) throw new ForbiddenError('This account has no access to any business.');
    // The header wins and is checked strictly. The web app also sets a cookie, so a plain link or a
    // new tab opens the same business. A cookie for a business no longer open to this person falls
    // back to the first one instead of locking them out.
    const header = c.req.header('X-Business-Id');
    let grant = grants[0]!;
    if (header !== undefined && header !== '') {
      const id = Number(header);
      const match = grants.find((g) => g.id === id);
      if (!Number.isSafeInteger(id) || !match) throw new ForbiddenError('This account has no access to that business.');
      grant = match;
    } else {
      const fromCookie = Number(businessCookie(c.req.header('Cookie')));
      grant = grants.find((g) => g.id === fromCookie) ?? grant;
    }

    c.set('user', {
      id: user.id,
      email: user.email,
      name: user.name,
      role: grant.role,
      features: await loadFeatures(env.DB, user, grant.role),
      theme: user.theme,
      locale: user.locale,
      businessId: grant.id,
      businesses: grants,
    });

    await next();

    if (grant.role === 'accountant') {
      await auditAs(env.DB, actorFrom(c), 'request', 'route', c.req.path, {
        method: c.req.method,
        status: c.res.status,
      });
    }
  };
}

/** The `ledger_business` cookie the web app sets when the person switches business. */
export function businessCookie(header: string | undefined): string | undefined {
  const match = /(?:^|;\s*)ledger_business=(\d+)/.exec(header ?? '');
  return match?.[1];
}

/** The businesses a person may open, with the role in each. Ended accountant access is left out. */
export async function businessGrants(db: D1Database, userId: number, today: string): Promise<{ id: number; role: Role }[]> {
  const rows = await all<{ business_id: number; role: Role }>(
    db,
    `SELECT business_id, role FROM user_businesses
      WHERE user_id = ? AND (ends_at IS NULL OR ends_at >= ?)
      ORDER BY business_id`,
    userId,
    today,
  );
  return rows.map((r) => ({ id: r.business_id, role: r.role }));
}

function currentUser(c: Parameters<MiddlewareHandler<AppEnv>>[0]): AuthUser {
  const user = c.get('user') as AuthUser | undefined;
  if (!user) throw new UnauthorizedError();
  return user;
}

export type RoleMiddleware = MiddlewareHandler<AppEnv> & { roles: readonly Role[] };
export type FeatureMiddleware = MiddlewareHandler<AppEnv> & { feature: Feature };

/** Lets the request through only for the listed roles. */
export function requireRole(...roles: Role[]): RoleMiddleware {
  const mw: MiddlewareHandler<AppEnv> = async (c, next) => {
    const user = currentUser(c);
    if (!roles.includes(user.role)) throw new ForbiddenError();
    await next();
  };
  return Object.assign(mw, { roles });
}

/** Owners pass. Accountants pass only for an enabled, non owner-only feature. */
export function hasFeature(user: AuthUser, feature: Feature): boolean {
  if (user.role === 'owner') return true;
  if (user.role === 'assistant') return (ASSISTANT_FEATURES as readonly string[]).includes(feature);
  if ((OWNER_ONLY_FEATURES as readonly string[]).includes(feature)) return false;
  return user.features.includes(feature);
}

/** Declares the feature a route belongs to and enforces it. The feature is readable as `.feature`. */
export function requireFeature(feature: Feature): FeatureMiddleware {
  const mw: MiddlewareHandler<AppEnv> = async (c, next) => {
    const user = currentUser(c);
    if (!hasFeature(user, feature)) throw new ForbiddenError();
    await next();
  };
  return Object.assign(mw, { feature });
}

/**
 * R24: a route for a feature that an assistant also reaches, such as the dashboard. Self-declaring
 * like requireFeature (src/modules/access/route-guard.ts reads `.feature`).
 */
export function requireFeatureOrAssistant(feature: Feature): FeatureMiddleware {
  const mw: MiddlewareHandler<AppEnv> = async (c, next) => {
    const user = currentUser(c);
    if (user.role !== 'assistant' && !hasFeature(user, feature)) throw new ForbiddenError();
    await next();
  };
  return Object.assign(mw, { feature });
}
