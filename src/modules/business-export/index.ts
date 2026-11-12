import { type Context, Hono } from 'hono';
import { actorFrom } from '../../core/audit';
import { requireRole } from '../../core/auth';
import { businessIdOf } from '../../core/business';
import { NotFoundError } from '../../core/errors';
import type { ModuleDef } from '../../core/module';
import type { AppEnv } from '../../env';
import { signDownloadUrl } from '../access/downloads';
import { type ExportRun, buildRunFile, getRun, listRuns, startRun } from './service';

export * from './service';

/**
 * R48 task 4: Settings > Businesses > Export, under /api/business-export. The owner of the
 * current business, which in the firm edition includes every Ledger admin. Each file is its own
 * request, so each stays inside a Worker's memory and time.
 */
async function withLinks(c: Context<AppEnv>, run: ExportRun) {
  const files = await Promise.all(
    run.plan.map(async (name) => {
      const f = run.files[name];
      if (!f) return { name, built: false };
      const keys = f.parts ? f.parts.map((p) => p.key) : [f.key];
      const links = await Promise.all(
        keys.map(async (key) => (await signDownloadUrl(c.env, key, 'settings', 3600, { filename: key.split('/').pop(), businessId: run.businessId })).path),
      );
      return { name, built: true, size: f.size, sha256: f.sha256, builtAt: f.builtAt, links };
    }),
  );
  return { id: run.id, createdAt: run.createdAt, completedAt: run.completedAt, files };
}

export function createBusinessExportModule(): ModuleDef {
  const r = new Hono<AppEnv>();
  r.use('*', requireRole('owner'));

  r.get('/runs', async (c) => {
    const runs = await listRuns(c.env.DB, businessIdOf(c));
    return c.json({ runs: runs.map((run) => ({ id: run.id, createdAt: run.createdAt, completedAt: run.completedAt, built: Object.keys(run.files).length, total: run.plan.length })) });
  });

  r.post('/runs', async (c) => {
    const run = await startRun(c.env.DB, actorFrom(c), businessIdOf(c));
    return c.json({ run: await withLinks(c, run) }, 201);
  });

  r.get('/runs/:run', async (c) => {
    const run = await getRun(c.env.DB, businessIdOf(c), c.req.param('run'));
    if (!run) throw new NotFoundError('Export run', c.req.param('run'));
    return c.json({ run: await withLinks(c, run) });
  });

  r.post('/runs/:run/files/:name', async (c) => {
    const run = await buildRunFile(c.env, actorFrom(c), businessIdOf(c), c.req.param('run'), c.req.param('name'));
    return c.json({ run: await withLinks(c, run) });
  });

  return { name: 'business-export', basePath: '/business-export', routes: r };
}

export const businessExportModule = createBusinessExportModule();
