import { type Context, Hono } from 'hono';
import { actorFrom } from '../../core/audit';
import { requireFeature } from '../../core/auth';
import { all, nowIso } from '../../core/db';
import { NotFoundError, ValidationError } from '../../core/errors';
import { setStartNumber } from '../../core/numbering';
import type { AppEnv } from '../../env';
import { runGapCheck } from './checks';
import { runBackup } from './backup';
import { businessPatch, ceilingInput, signatureModeInput, startNumberInput, vatRateInput } from './schemas';
import {
  addVatRate,
  getBusinessProfile,
  getSignatureMode,
  missingBusinessFields,
  listCeilings,
  listSeries,
  listVatRates,
  setBusinessLogo,
  setSignatureImage,
  setSignatureMode,
  updateBusinessProfile,
  upsertCeiling,
} from './settings-service';

interface BackupRow {
  id: number;
  kind: string;
  ran_at: string;
  d1_export_key: string;
  manifest_key: string;
  table_count: number;
  document_count: number;
  chain_head_hash: string;
  restore_ok: number;
  restore_error: string | null;
}

async function jsonBody(c: Context<AppEnv>): Promise<unknown> {
  const text = await c.req.text();
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    throw new ValidationError('The request body is not valid JSON.');
  }
}

const IMAGE_EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Stores an uploaded logo or signature image in R2 under business/. PNG, JPEG, WebP or SVG, up to 2 MB. */
async function storeImage(c: Context<AppEnv>, kind: 'logo' | 'signature'): Promise<string> {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new ValidationError('Attach a file under the "file" field.');
  const ext = IMAGE_EXTENSIONS[file.type];
  if (!ext) throw new ValidationError('Upload a PNG, JPEG, WebP or SVG image.');
  if (file.size > MAX_IMAGE_BYTES) throw new ValidationError('The image is larger than 2 MB.');
  const key = `business/${kind}-${Date.now()}.${ext}`;
  await c.env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return key;
}

async function serveImage(c: Context<AppEnv>, key: string | null, label: string): Promise<Response> {
  if (!key) throw new NotFoundError(label);
  const object = await c.env.FILES.get(key);
  if (!object) throw new NotFoundError(label);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, no-cache');
  return new Response(object.body, { headers });
}

/** Routes under /api/ops. Every route is owner only, the `settings` feature (CLAUDE.md rule 6). */
export function opsRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.use('*', requireFeature('settings'));

  r.get('/business', async (c) => c.json({ business: await getBusinessProfile(c.env.DB) }));

  r.put('/business', async (c) => {
    const input = businessPatch.parse(await jsonBody(c));
    const business = await updateBusinessProfile(c.env.DB, actorFrom(c), input);
    return c.json({ business });
  });

  r.get('/business/setup', async (c) => {
    const missing = await missingBusinessFields(c.env.DB);
    return c.json({ complete: missing.length === 0, missing });
  });

  r.get('/business/logo', async (c) => serveImage(c, (await getBusinessProfile(c.env.DB)).logo_r2_key, 'Logo'));

  r.post('/business/logo', async (c) => {
    const key = await storeImage(c, 'logo');
    await setBusinessLogo(c.env.DB, actorFrom(c), key);
    return c.json({ logoR2Key: key });
  });

  r.delete('/business/logo', async (c) => {
    await setBusinessLogo(c.env.DB, actorFrom(c), null);
    return c.json({ logoR2Key: null });
  });

  r.get('/business/signature', async (c) => serveImage(c, (await getBusinessProfile(c.env.DB)).signature_r2_key, 'Signature'));

  r.post('/business/signature', async (c) => {
    const key = await storeImage(c, 'signature');
    await setSignatureImage(c.env.DB, actorFrom(c), key);
    return c.json({ signatureR2Key: key });
  });

  r.delete('/business/signature', async (c) => {
    await setSignatureImage(c.env.DB, actorFrom(c), null);
    return c.json({ signatureR2Key: null });
  });

  r.get('/series', async (c) => c.json({ series: await listSeries(c.env.DB) }));

  r.put('/series/:id/start-number', async (c) => {
    const input = startNumberInput.parse(await jsonBody(c));
    await setStartNumber(c.env.DB, c.req.param('id'), input.startNumber, actorFrom(c));
    return c.json({ series: await listSeries(c.env.DB) });
  });

  r.get('/ceilings', async (c) => c.json({ ceilings: await listCeilings(c.env.DB) }));

  r.put('/ceilings', async (c) => {
    const input = ceilingInput.parse(await jsonBody(c));
    await upsertCeiling(c.env.DB, actorFrom(c), input);
    return c.json({ ceilings: await listCeilings(c.env.DB) });
  });

  r.get('/vat-rates', async (c) => c.json({ vatRates: await listVatRates(c.env.DB) }));

  r.post('/vat-rates', async (c) => {
    const input = vatRateInput.parse(await jsonBody(c));
    await addVatRate(c.env.DB, actorFrom(c), input);
    return c.json({ vatRates: await listVatRates(c.env.DB) }, 201);
  });

  r.get('/signature-mode', async (c) => c.json({ mode: await getSignatureMode(c.env.DB) }));

  r.put('/signature-mode', async (c) => {
    const input = signatureModeInput.parse(await jsonBody(c));
    await setSignatureMode(c.env.DB, actorFrom(c), input.mode);
    return c.json({ mode: input.mode });
  });

  r.post('/checks/run', async (c) => c.json(await runGapCheck(c.env.DB)));

  r.get('/backups', async (c) => c.json({ backups: await all<BackupRow>(c.env.DB, 'SELECT * FROM backups ORDER BY ran_at DESC LIMIT 50') }));

  r.post('/backups/run', async (c) => {
    const result = await runBackup(c.env, 'manual', nowIso());
    return c.json(result, 201);
  });

  return r;
}
