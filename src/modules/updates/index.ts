import { Hono } from 'hono';
import { actorFrom, auditAs } from '../../core/audit';
import { requireFeature } from '../../core/auth';
import type { ModuleDef } from '../../core/module';
import type { AppEnv, Env } from '../../env';
import { APP_VERSION } from '../../version';
import { UPDATE_CHECK_CRON, checkForUpdate, lastCheck, saveCheck, updateRepo, updatesScheduled } from './service';

/** Routes under /api/updates. Owner only, like the rest of Settings. */
export function createUpdatesModule(fetcher?: typeof fetch): ModuleDef {
  const r = new Hono<AppEnv>();
  r.use('*', requireFeature('settings'));

  r.get('/', async (c) =>
    c.json({ current: APP_VERSION, repo: updateRepo(c.env), last: await lastCheck(c.env.DB) }),
  );

  r.post('/check', async (c) => {
    const check = await checkForUpdate(c.env, fetcher ?? ((input, init) => fetch(input, init)));
    await saveCheck(c.env.DB, check);
    await auditAs(c.env.DB, actorFrom(c), 'updates.check', 'updates', null, { status: check.status, current: check.current, latest: check.latest });
    return c.json({ current: APP_VERSION, repo: updateRepo(c.env), last: check });
  });

  return {
    name: 'updates',
    basePath: '/updates',
    routes: r,
    crons: [UPDATE_CHECK_CRON],
    async scheduled(controller: ScheduledController, env: Env) {
      await updatesScheduled(controller, env);
    },
  };
}

export const updatesModule = createUpdatesModule();
export { UPDATE_CHECK_CRON, checkForUpdate, compareVersions, parseVersion, updatesScheduled } from './service';
