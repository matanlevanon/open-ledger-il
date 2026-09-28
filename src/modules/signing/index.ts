import { Hono } from 'hono';
import { requireFeature } from '../../core/auth';
import type { ModuleDef } from '../../core/module';
import type { AppEnv } from '../../env';
import { certificateInfo } from './cms';

const routes = new Hono<AppEnv>();

/** Whether the two signing secrets are set, and the current certificate's validity window. Never returns key material. */
routes.get('/status', requireFeature('settings'), (c) => {
  const { SIGNING_KEY_PEM, SIGNING_CERT_PEM } = c.env;
  if (!SIGNING_KEY_PEM || !SIGNING_CERT_PEM) return c.json({ configured: false });
  try {
    return c.json({ configured: true, ...certificateInfo(SIGNING_CERT_PEM) });
  } catch {
    return c.json({ configured: true, error: 'The signing certificate could not be read.' });
  }
});

export const signingModule: ModuleDef = {
  name: 'signing',
  basePath: '/signing',
  routes,
};

export { signPdf, verifyPdf } from './pades';
export type { SignPdfOptions, SigningIdentity, VerifyPdfResult } from './pades';
