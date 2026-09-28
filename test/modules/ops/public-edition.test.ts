import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/index';
import { opsModule } from '../../../src/modules/ops';
import { isValidIsraeliId } from '../../../src/modules/ops/israeli-id';
import { api as documentsApi, line } from '../../documents/helpers';

const app = createApp({ modules: [opsModule] });

async function ops(method: string, path: string, body?: BodyInit, contentType = 'application/json') {
  const res = await app.request(
    `/api/ops${path}`,
    { method, headers: body === undefined || body instanceof FormData ? {} : { 'Content-Type': contentType }, body },
    { ...env, DEV_AUTH_EMAIL: 'owner@example.com' },
  );
  return res;
}

function imageForm(type: string, bytes: Uint8Array<ArrayBuffer> = new Uint8Array([137, 80, 78, 71])): FormData {
  const form = new FormData();
  form.append('file', new File([bytes], 'image', { type }));
  return form;
}

/** Storage is shared per test file, so the profile is restored after each check that empties it. */
async function withEmptyTaxId(fn: () => Promise<void>) {
  await env.DB.prepare("UPDATE business_profile SET tax_id = NULL WHERE id = 1").run();
  try {
    await fn();
  } finally {
    await env.DB.prepare("UPDATE business_profile SET tax_id = '123456782' WHERE id = 1").run();
  }
}

describe('R22: Israeli ID check digit', () => {
  it('accepts valid 9-digit numbers and pads shorter ones', () => {
    expect(isValidIsraeliId('123456782')).toBe(true);
    expect(isValidIsraeliId('000000018')).toBe(true);
    expect(isValidIsraeliId('18')).toBe(false);
    expect(isValidIsraeliId('00018')).toBe(true);
  });

  it('rejects a wrong check digit and non-digits', () => {
    expect(isValidIsraeliId('123456789')).toBe(false);
    expect(isValidIsraeliId('12345678A')).toBe(false);
    expect(isValidIsraeliId('')).toBe(false);
  });
});

describe('R22: first-run setup gate', () => {
  it('reports the setup complete once the required fields are filled', async () => {
    const res = await ops('GET', '/business/setup');
    expect(await res.json()).toEqual({ complete: true, missing: [] });
  });

  it('refuses to create a document while a required business field is empty', async () => {
    await withEmptyTaxId(async () => {
      const setup = await ops('GET', '/business/setup');
      expect(await setup.json()).toEqual({ complete: false, missing: ['tax_id'] });

      const res = await documentsApi('POST', '/documents', { type: 'QT', lines: [line(10000)] });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('business_profile_incomplete');
    });
    const after = await documentsApi('POST', '/documents', { type: 'QT', lines: [line(10000)] });
    expect(after.status).toBe(201);
  });

  it('saves a valid tax id and refuses an invalid one', async () => {
    const bad = await ops('PUT', '/business', JSON.stringify({ taxId: '123456789' }));
    expect(bad.status).toBe(400);
    const good = await ops('PUT', '/business', JSON.stringify({ taxId: '123456782' }));
    expect(good.status).toBe(200);
    expect(((await good.json()) as { business: { tax_id: string } }).business.tax_id).toBe('123456782');
  });
});

describe('R22: logo and signature images live in R2, not in code', () => {
  it('uploads, serves and removes the signature image', async () => {
    expect((await ops('GET', '/business/signature')).status).toBe(404);

    const up = await ops('POST', '/business/signature', imageForm('image/png'));
    expect(up.status).toBe(200);
    const { signatureR2Key } = (await up.json()) as { signatureR2Key: string };
    expect(signatureR2Key).toMatch(/^business\/signature-\d+\.png$/);

    const served = await ops('GET', '/business/signature');
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    await served.arrayBuffer();

    expect((await ops('DELETE', '/business/signature')).status).toBe(200);
    expect((await ops('GET', '/business/signature')).status).toBe(404);
  });

  it('refuses a file that is not an image', async () => {
    const res = await ops('POST', '/business/logo', imageForm('application/pdf'));
    expect(res.status).toBe(400);
  });

  it('audits every image change', async () => {
    await ops('POST', '/business/logo', imageForm('image/svg+xml', new Uint8Array(new TextEncoder().encode('<svg/>'))));
    const row = await env.DB.prepare("SELECT action FROM audit_log WHERE action = 'ops.business_logo_update' ORDER BY id DESC").first<{ action: string }>();
    expect(row?.action).toBe('ops.business_logo_update');
  });
});
