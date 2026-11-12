import { Hono } from 'hono';
import { z } from 'zod';
import { actorFrom } from '../../core/audit';
import { requireFeature, requireRole } from '../../core/auth';
import { FIRST_BUSINESS, businessIdOf, forEachBusiness } from '../../core/business';
import { first, todayIsrael } from '../../core/db';
import { ledgerEdition } from '../../core/edition';
import { ForbiddenError, ValidationError } from '../../core/errors';
import type { ModuleDef } from '../../core/module';
import type { AppEnv } from '../../env';
import { isDemo } from '../demo/config';
import { certificateInfo } from './cms';
import { activeSigningKey, addExpiryTasks, infoOf, signingKeyHistory, storeSigningKey } from './keys';

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

/**
 * R48 task 3: Settings > Digital signature for the current business. The business's own key,
 * or the Ledger's shared key it falls back to, and the retired keys. Never key material.
 */
routes.get('/', requireRole('owner'), async (c) => {
  const businessId = businessIdOf(c);
  const edition = ledgerEdition(c.env);
  const business = await first<{ name_en: string; name_he: string; tax_id: string | null }>(
    c.env.DB,
    'SELECT name_en, name_he, tax_id FROM businesses WHERE id = ?',
    businessId,
  );
  const active = await activeSigningKey(c.env.DB, businessId);
  const sharedAllowed = edition === 'single' || businessId === FIRST_BUSINESS;
  let ledgerSubject: string | null = null;
  if (!active && sharedAllowed && c.env.SIGNING_CERT_PEM) {
    try {
      ledgerSubject = certificateInfo(c.env.SIGNING_CERT_PEM).commonName ?? null;
    } catch {
      ledgerSubject = null;
    }
  }
  return c.json({
    businessId,
    businessName: (business?.name_he || business?.name_en || '').trim(),
    taxId: business?.tax_id ?? null,
    edition,
    mode: active ? 'own' : ledgerSubject !== null || (sharedAllowed && c.env.SIGNING_KEY_PEM) ? 'ledger' : 'none',
    ledgerSubject,
    active: active ? infoOf(active) : null,
    history: await signingKeyHistory(c.env.DB, businessId),
  });
});

const keyInput = z.object({
  keyPem: z.string().min(100).max(20_000),
  certPem: z.string().min(100).max(20_000),
  source: z.enum(['generated', 'uploaded']),
});

/**
 * R48 task 3: stores a key made in the browser, or uploaded, as the business's active key. The
 * old key is retired. The key never comes back in any response.
 */
routes.post('/key', requireRole('owner'), async (c) => {
  if (isDemo(c.env)) throw new ForbiddenError('The demo keeps its demo certificate.');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ValidationError('The request body is not valid JSON.');
  }
  const input = keyInput.parse(body);
  const { key, warning } = await storeSigningKey(c.env.DB, c.env, actorFrom(c), businessIdOf(c), input);
  c.header('Cache-Control', 'no-store');
  return c.json({ key, warning }, 201);
});

/** R48: the daily expiry check, on the same daily cron as the access expiry check. */
export const SIGNING_EXPIRY_CRON = '0 7 * * *';

export const signingModule: ModuleDef = {
  name: 'signing',
  basePath: '/signing',
  routes,
  crons: [SIGNING_EXPIRY_CRON],
  async scheduled(controller, env) {
    if (controller.cron !== SIGNING_EXPIRY_CRON) return;
    const today = todayIsrael();
    await forEachBusiness(env.DB, 'signing.expiry', async (businessId) => {
      await addExpiryTasks(env.DB, businessId, today);
    });
  },
};

export { signPdf, verifyPdf } from './pades';
export type { SignPdfOptions, SigningIdentity, VerifyPdfResult } from './pades';
