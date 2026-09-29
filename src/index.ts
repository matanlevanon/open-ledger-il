import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z, ZodError } from 'zod';
import { type AuthOptions, authenticate } from './core/auth';
import { nowIso, run } from './core/db';
import { issuingEnabled } from './core/issuing';
import { DomainError, mapDbError } from './core/errors';
import type { ModuleDef } from './core/module';
import type { AppEnv, Env } from './env';
import { modules as registeredModules } from './modules';
import { isPublicApiPath } from './modules/sending/public-paths';
import { mcpModule } from './modules/mcp';
import { dispatchScheduled } from './scheduled';

export interface AppOptions {
  auth?: AuthOptions;
  modules?: ModuleDef[];
}

function errorBody(code: string, message: string, details?: unknown) {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/** Builds the Worker app. Tests call this with a local JWKS and extra modules. */
export function createApp(options: AppOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const api = new Hono<AppEnv>();

  api.get('/health', (c) => c.json({ ok: true, service: 'open-ledger-il', environment: c.env.ENVIRONMENT }));

  // A handful of routes (the consent-accept page, the WhatsApp share link) are opened by the
  // client, not a signed-in owner or accountant, so they carry no Cloudflare Access session.
  // Their own signed, expiring token is the authorization (src/modules/sending/tokens.ts).
  api.use('*', async (c, next) => {
    if (isPublicApiPath(c.req.path)) return next();
    return authenticate(options.auth)(c, next);
  });

  api.get('/me', async (c) => {
    const user = c.get('user');
    return c.json({
      user: {
        email: user.email,
        name: user.name,
        role: user.role,
        features: user.features,
        theme: user.theme,
        locale: user.locale,
        issuing: await issuingEnabled(c.env.DB),
      },
    });
  });

  const preferencesInput = z.object({
    theme: z.enum(['light', 'dark']).nullish(),
    locale: z.enum(['en', 'he']).nullish(),
  });

  /** R16 tasks 15/16: remembers the signed-in user's theme and interface-language choice across devices. */
  api.patch('/me/preferences', async (c) => {
    const user = c.get('user');
    const input = preferencesInput.parse(await c.req.json().catch(() => ({})));
    const sets: string[] = [];
    const params: (string | null)[] = [];
    if (input.theme !== undefined) {
      sets.push('theme = ?');
      params.push(input.theme ?? null);
    }
    if (input.locale !== undefined) {
      sets.push('locale = ?');
      params.push(input.locale ?? null);
    }
    if (sets.length > 0) {
      await run(c.env.DB, `UPDATE users SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...params, nowIso(), user.id);
    }
    return c.json({
      theme: input.theme !== undefined ? (input.theme ?? null) : user.theme,
      locale: input.locale !== undefined ? (input.locale ?? null) : user.locale,
    });
  });

  for (const m of options.modules ?? registeredModules) api.route(m.basePath, m.routes);

  api.notFound((c) => c.json(errorBody('not_found', 'No such endpoint.'), 404));

  app.route('/api', api);

  // Bearer-token MCP endpoint (MCP_TOKEN secret), not Cloudflare Access, so it is mounted here
  // rather than through the /api registry. wrangler.toml routes /mcp and /mcp/* to the Worker.
  app.route('/mcp', mcpModule.routes);

  app.notFound(async (c) => {
    if (c.req.path.startsWith('/api/')) return c.json(errorBody('not_found', 'No such endpoint.'), 404);
    if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
    return c.text('Not found', 404);
  });

  app.onError((err, c) => {
    const mapped = mapDbError(err);
    if (mapped instanceof DomainError) {
      return c.json(errorBody(mapped.code, mapped.message, mapped.details), mapped.status);
    }
    if (mapped instanceof ZodError) {
      return c.json(errorBody('validation_error', 'Some fields are not valid.', mapped.issues), 400);
    }
    if (mapped instanceof HTTPException) {
      return c.json(errorBody('http_error', mapped.message || 'Request failed.'), mapped.status as ContentfulStatusCode);
    }
    // Log the error type and message only. Never log request bodies or secrets.
    console.error('unhandled_error', mapped instanceof Error ? `${mapped.name}: ${mapped.message}` : 'unknown');
    return c.json(errorBody('internal_error', 'Something went wrong. Try again.'), 500);
  });

  return app;
}

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dispatchScheduled(controller, env, ctx, registeredModules));
  },
} satisfies ExportedHandler<Env>;
