import type { MiddlewareHandler } from 'hono';
import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppEnv, Env } from '../env';
import { SYSTEM_ACTOR, actorFrom, auditAs, auditStatement } from './audit';
import { all, first, stmt, todayIsrael, transaction } from './db';
import { ForbiddenError, UnauthorizedError } from './errors';

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

export type Role = 'owner' | 'accountant';

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

async function loadFeatures(db: D1Database, user: UserRow): Promise<Feature[]> {
  if (user.role === 'owner') return [...FEATURES];
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
       WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'owner')`,
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
    if (token) {
      email = await emailFromAccessJwt(token, env, options);
    } else if (devBypassAllowed(env)) {
      email = env.DEV_AUTH_EMAIL!.trim().toLowerCase();
    } else {
      throw new UnauthorizedError();
    }

    let user = await first<UserRow>(env.DB, 'SELECT * FROM users WHERE email = ?', email);
    if (!user) user = await bootstrapOwner(env.DB, env, email);
    if (!user) throw new ForbiddenError('This account has no access to Open Ledger IL.');
    if (user.active !== 1) throw new ForbiddenError('This account is disabled.');
    const today = (options.today ?? todayIsrael)();
    if (user.access_ends_on && user.access_ends_on < today) {
      throw new ForbiddenError('Access for this account has ended.');
    }

    c.set('user', {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      features: await loadFeatures(env.DB, user),
      theme: user.theme,
      locale: user.locale,
    });

    await next();

    if (user.role === 'accountant') {
      await auditAs(env.DB, actorFrom(c), 'request', 'route', c.req.path, {
        method: c.req.method,
        status: c.res.status,
      });
    }
  };
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
