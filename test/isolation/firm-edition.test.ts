import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/index';

/**
 * R48 task 2: the firm edition. Any business type for any client business, a tax id unique in
 * every edition, and the single edition keeps its one-עוסק rule.
 */
const app = createApp();
const OWNER = 'owner@example.com';

async function call(method: string, path: string, body: unknown, edition: 'single' | 'firm', businessId = 1) {
  const res = await app.request(
    `/api${path}`,
    { method, headers: { 'content-type': 'application/json', 'X-Business-Id': String(businessId) }, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: OWNER, LEDGER_EDITION: edition },
  );
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
}

const patur = (nameEn: string, taxId: string) => ({ entityType: 'osek_patur', nameEn, nameHe: nameEn, taxId, addressEn: 'Tel Aviv' });

beforeAll(async () => {
  await call('GET', '/businesses', undefined, 'single');
  // Business 1 is an עוסק פטור with a tax id, as a fresh Ledger is.
  await env.DB.prepare("UPDATE businesses SET tax_id = '514000058', entity_type = 'osek_patur' WHERE id = 1").run();
});

describe('R48 firm edition: business types', () => {
  it('single refuses a second עוסק file, with one_osek_only', async () => {
    const res = await call('POST', '/businesses', patur('Second Patur', '514000066'), 'single');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('one_osek_only');
    expect((await call('GET', '/businesses', undefined, 'single')).body.addableTypes).toEqual(['company']);
  });

  it('firm allows a second and a third פטור', async () => {
    expect((await call('GET', '/businesses', undefined, 'firm')).body.addableTypes).toEqual(['osek_patur', 'osek_murshe', 'company']);
    expect((await call('POST', '/businesses', patur('Client Patur Two', '514000066'), 'firm')).status).toBe(201);
    expect((await call('POST', '/businesses', patur('Client Patur Three', '514000074'), 'firm')).status).toBe(201);
  });
});

describe('R48 tax id unique in every edition', () => {
  it('a duplicate is refused with 409 tax_id_taken, in single and in firm', async () => {
    for (const edition of ['single', 'firm'] as const) {
      const res = await call('POST', '/businesses', { entityType: 'company', nameEn: 'Dup Ltd', nameHe: 'Dup', taxId: '514000074', addressEn: 'X' }, edition);
      expect(res.status, edition).toBe(409);
      expect(res.body.error.code).toBe('tax_id_taken');
    }
  });

  it('spaces and dashes do not hide a duplicate', async () => {
    const res = await call('POST', '/businesses', { entityType: 'company', nameEn: 'Dup Ltd', nameHe: 'Dup', taxId: '51400-0074', addressEn: 'X' }, 'firm');
    expect(res.status).toBe(409);
  });

  it('Settings > Business refuses another business tax id, and saves its own unchanged', async () => {
    expect((await call('PUT', '/ops/business', { taxId: '514000074' }, 'single')).status).toBe(409);
    expect((await call('PUT', '/ops/business', { taxId: '514000058', nameEn: 'Still Me' }, 'single')).status).toBe(200);
  });
});

describe('R48 edition in Settings > Updates', () => {
  it('reads the Worker variable, single by default', async () => {
    expect((await call('GET', '/updates', undefined, 'single')).body.edition).toBe('single');
    expect((await call('GET', '/updates', undefined, 'firm')).body.edition).toBe('firm');
  });
});
