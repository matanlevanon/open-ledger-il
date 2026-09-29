import { Hono } from 'hono';
import { hasFeature } from '../../core/auth';
import { todayIsrael } from '../../core/db';
import { ForbiddenError, NotFoundError } from '../../core/errors';
import type { ModuleDef } from '../../core/module';
import type { AppEnv, Env } from '../../env';
import { verifyDownloadToken } from './downloads';
import { runAccessExpiryCheck } from './expiry';
import { logRoutes } from './log';
import { SlackAccessNotifier } from './notifier';
import { declareManualAuth } from './route-guard';
import { usersRoutes } from './users';

export { signDownloadUrl } from './downloads';

/** Daily cron. Enabled in wrangler.toml's [triggers] block. */
export const ACCESS_EXPIRY_CRON = '0 7 * * *';

const routes = new Hono<AppEnv>();

routes.route('/users', usersRoutes);
routes.route('/log', logRoutes);

// The feature that gates this download lives inside the signed token, chosen by whoever called
// signDownloadUrl. Authorization is the hasFeature check below, not a static requireFeature.
routes.get(
  '/downloads/:token',
  declareManualAuth('feature is embedded in the signed token, enforced by hasFeature() below'),
  async (c) => {
    const payload = await verifyDownloadToken(c.env, c.req.param('token'));
    if (!hasFeature(c.get('user'), payload.feature)) throw new ForbiddenError();

    const object = await c.env.FILES.get(payload.key);
    if (!object) throw new NotFoundError('file', payload.key);

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    const disposition = payload.disposition ?? 'attachment';
    const filename = payload.filename ?? payload.key.split('/').pop();
    headers.set('content-disposition', `${disposition}; filename="${filename}"`);
    return new Response(object.body, { headers });
  },
);

export const accessModule: ModuleDef = {
  name: 'access',
  basePath: '/access',
  routes,
  crons: [ACCESS_EXPIRY_CRON],
  async scheduled(controller: ScheduledController, env: Env) {
    if (controller.cron !== ACCESS_EXPIRY_CRON) return;
    await runAccessExpiryCheck(env.DB, new SlackAccessNotifier(env.SLACK_WEBHOOK_URL), todayIsrael());
  },
};
