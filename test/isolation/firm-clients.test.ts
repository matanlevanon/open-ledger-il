import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/index';

/** R48 task 7: the Clients page. Firm staff see every client, a client owner gets 403. */
const app = createApp();
const ADMIN = 'owner@example.com';
const STAFF = 'noauto-clients-staff@example.com';
const CLIENT = 'noauto-clients-owner@example.com';

async function call(email: string, businessId: number, method: string, path: string, body?: unknown, edition = 'firm') {
  const res = await app.request(
    `/api${path}`,
    { method, headers: { 'content-type': 'application/json', 'X-Business-Id': String(businessId) }, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: email, LEDGER_EDITION: edition },
  );
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
}

let A = 0;
let B = 0;

beforeAll(async () => {
  await call(ADMIN, 1, 'GET', '/businesses');
  A = (await call(ADMIN, 1, 'POST', '/businesses', { entityType: 'osek_patur', nameEn: 'Alef Patur', nameHe: 'אלף', taxId: '514000173', addressEn: 'X' })).body.businessId;
  B = (await call(ADMIN, 1, 'POST', '/businesses', { entityType: 'company', nameEn: 'Bet Ltd', nameHe: 'בית', taxId: '514000181', addressEn: 'X' })).body.businessId;
  await call(ADMIN, 1, 'POST', '/access/firm-team', { email: STAFF, role: 'accountant' });
  await call(ADMIN, A, 'POST', '/access/users', { email: CLIENT, role: 'owner' });
});

describe('R48 Clients page', () => {
  it('firm staff see both clients, one row each', async () => {
    const res = await call(STAFF, A, 'GET', '/firm/clients');
    expect(res.status).toBe(200);
    const ids = res.body.clients.map((c: { id: number }) => c.id);
    expect(ids).toEqual(expect.arrayContaining([A, B]));
    const b = res.body.clients.find((c: { id: number }) => c.id === B);
    expect(b.entityType).toBe('company');
    expect(b.vat.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(b.ita).toBe('none');
    const a = res.body.clients.find((c: { id: number }) => c.id === A);
    expect(a.vat).toBeNull();
  });

  it('search and the needs-attention filter', async () => {
    const res = await call(ADMIN, 1, 'GET', '/firm/clients?q=bet');
    expect(res.body.clients.map((c: { id: number }) => c.id)).toEqual([B]);
    const attention = await call(ADMIN, 1, 'GET', '/firm/clients?attention=1');
    expect(attention.status).toBe(200);
    // B has no signing key of its own in the firm edition, so it needs attention.
    expect(attention.body.clients.some((c: { id: number }) => c.id === B)).toBe(true);
  });

  it('a client owner gets 403, and the single edition has no Clients page', async () => {
    expect((await call(CLIENT, A, 'GET', '/firm/clients')).status).toBe(403);
    expect((await call(ADMIN, 1, 'GET', '/firm/clients', undefined, 'single')).status).toBe(403);
  });
});
