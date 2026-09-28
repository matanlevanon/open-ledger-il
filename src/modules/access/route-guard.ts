import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../../env';
import type { ModuleDef } from '../../core/module';

/**
 * CLAUDE.md rule 6 and runs/R09-accountant.md: every route declares its feature. `requireFeature`
 * and `requireRole` (src/core/auth.ts) expose `.feature` / `.roles` on the middleware function, so
 * a route that uses either is self-declaring. A route whose authorization is data-dependent (for
 * example the signed download link, gated on the feature named inside the token) cannot carry a
 * static declaration; it marks itself with `declareManualAuth` instead, naming the check that
 * replaces it. A module-wide `routes.use('*', requireFeature(...))` declares every route
 * registered after it. `findUndeclaredRoutes` walks a module list and reports anything with neither.
 */
export type ManualAuthMiddleware = MiddlewareHandler<AppEnv> & { manualAuth: string };

export function declareManualAuth(reason: string): ManualAuthMiddleware {
  const mw: MiddlewareHandler<AppEnv> = async (_c, next) => next();
  return Object.assign(mw, { manualAuth: reason });
}

export interface UndeclaredRoute {
  module: string;
  method: string;
  path: string;
}

interface DeclarableHandler {
  feature?: unknown;
  roles?: unknown;
  manualAuth?: unknown;
}

/** Every (method, path) pair in a module lacking a feature, role, or manual-auth declaration on any of its handlers. */
export function findUndeclaredRoutes(modules: ModuleDef[]): UndeclaredRoute[] {
  const violations: UndeclaredRoute[] = [];
  for (const m of modules) {
    const declaredByKey = new Map<string, boolean>();
    let moduleWide = false;
    for (const r of m.routes.routes) {
      const key = `${r.method} ${r.path}`;
      const h = r.handler as DeclarableHandler;
      const declared = h.feature !== undefined || h.roles !== undefined || h.manualAuth !== undefined;
      // Hono registers `use('*', mw)` as method ALL on path /*. It covers the routes added after it.
      if (declared && r.method === 'ALL' && (r.path === '/*' || r.path === '*')) moduleWide = true;
      declaredByKey.set(key, (declaredByKey.get(key) ?? false) || declared || moduleWide);
    }
    for (const [key, declared] of declaredByKey) {
      if (declared) continue;
      const [method, ...pathParts] = key.split(' ');
      violations.push({ module: m.name, method: method!, path: pathParts.join(' ') });
    }
  }
  return violations;
}
