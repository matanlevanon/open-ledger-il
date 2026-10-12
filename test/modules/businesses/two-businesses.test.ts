import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { all, first } from '../../../src/core/db';
import { verifyChain } from '../../../src/core/hashchain';
import { sqlError } from '../../helpers';
import { OWNER, TODAY, businessesApp, callIn, finalPaymentRequest, okIn } from './helpers';

/**
 * R24 Phase B (R23 tasks 2, 3, 5): two businesses in one Ledger. Numbers, hash chains, clients and
 * documents stay inside their business. The tests run in order in one database.
 */
const app = businessesApp();
let b2 = 0;

beforeAll(async () => {
  // The owner signs in once, which makes them owner of business 1.
  await okIn(app, OWNER, null, 'GET', '/businesses');
  const res = await okIn(app, OWNER, 1, 'POST', '/businesses', {
    entityType: 'company',
    nameEn: 'Second Company Ltd',
    nameHe: 'חברה שנייה בע"מ',
    taxId: '515555555',
    addressEn: 'Haifa',
  });
  b2 = res.businessId;
});

describe('two businesses in one Ledger', () => {
  it('the new business is a company, VAT registered from today, owned by its creator', async () => {
    const list = await okIn(app, OWNER, 1, 'GET', '/businesses');
    expect(list.businesses.map((b: { id: number; entityType: string; role: string }) => [b.id, b.entityType, b.role])).toEqual([
      [1, 'osek_patur', 'owner'],
      [b2, 'company', 'owner'],
    ]);
    const status = await okIn(app, OWNER, b2, 'GET', '/legal-mode/status');
    expect(status).toMatchObject({ entityType: 'company', showCeiling: false });
    const brands = await all(env.DB, 'SELECT business_id, is_default FROM brands WHERE business_id = ?', b2);
    expect(brands).toEqual([{ business_id: b2, is_default: 1 }]);
  });

  it('numbers each business on its own series, with no gaps, interleaved', async () => {
    const a1 = await finalPaymentRequest(app, 1);
    const c1 = await finalPaymentRequest(app, b2);
    const a2 = await finalPaymentRequest(app, 1);
    const c2 = await finalPaymentRequest(app, b2);
    const rows = await all<{ id: number; series_id: string; number: number; business_id: number }>(
      env.DB,
      `SELECT id, series_id, number, business_id FROM documents WHERE id IN (?, ?, ?, ?) ORDER BY id`,
      a1.id,
      c1.id,
      a2.id,
      c2.id,
    );
    const b1Numbers = rows.filter((r) => r.business_id === 1).map((r) => r.number);
    const b2Numbers = rows.filter((r) => r.business_id === b2).map((r) => r.number);
    expect(b1Numbers[1]).toBe(b1Numbers[0]! + 1);
    // Business 2's first payment request is its own series start, never continuing business 1.
    expect(b2Numbers).toEqual([1, 2]);
    expect(rows.find((r) => r.id === c1.id)?.series_id).toBe(`b${b2}-PR`);
  });

  it('keeps one hash chain per business, and each verifies on its own', async () => {
    const report = await verifyChain(env.DB);
    expect(report.ok).toBe(true);
    const firstOfB2 = await first<{ prev_hash: string }>(env.DB, 'SELECT prev_hash FROM finalizations WHERE business_id = ? ORDER BY seq LIMIT 1', b2);
    expect(firstOfB2?.prev_hash).toBe('0'.repeat(64));
    expect(report.headHashes[b2]).toBeDefined();
    expect(report.headHashes[1]).not.toBe(report.headHashes[b2]);
  });

  it('never shows a document or client of one business in the other', async () => {
    const own = await finalPaymentRequest(app, 1);
    expect((await callIn(app, OWNER, b2, 'GET', `/documents/${own.id}`)).status).toBe(404);
    expect((await callIn(app, OWNER, b2, 'GET', `/clients/${own.clientId}`)).status).toBe(404);
    const list = await okIn(app, OWNER, b2, 'GET', '/documents?tab=all&limit=200');
    expect(list.items.some((d: { id: number }) => d.id === own.id)).toBe(false);
    const clients = await okIn(app, OWNER, b2, 'GET', '/clients');
    expect(clients.clients.some((c: { id: number }) => c.id === own.clientId)).toBe(false);
  });

  it('never links, credits or converts across businesses', async () => {
    const one = await finalPaymentRequest(app, 1);
    const two = await finalPaymentRequest(app, b2);
    expect(
      (await callIn(app, OWNER, b2, 'POST', `/documents/${one.id}/record-payment`, { payments: [{ method: 'bank_transfer', paidOn: TODAY, amountMinor: 100 }], finalize: false }))
        .status,
    ).toBe(404);
    expect((await callIn(app, OWNER, b2, 'POST', `/documents/${one.id}/credit`, { mode: 'full', finalize: false })).status).toBe(404);
    expect(await sqlError("INSERT INTO document_links (source_id, target_id, kind, amount_minor, currency) VALUES (?, ?, 'converted', NULL, NULL)", one.id, two.id)).toContain(
      'business_mismatch',
    );
  });

  it('refuses a document whose client or series belongs to another business (raw SQL)', async () => {
    const theirs = await finalPaymentRequest(app, b2);
    expect(
      await sqlError("INSERT INTO documents (type, series_id, date, client_id, business_id) VALUES ('PR', 'PR', ?, ?, 1)", TODAY, theirs.clientId),
    ).toContain('business_mismatch');
    expect(await sqlError("INSERT INTO documents (type, series_id, date, business_id) VALUES ('PR', 'PR', ?, ?)", TODAY, b2)).toContain('business_mismatch');
  });

  it('reports and the dashboard read one business', async () => {
    const r1 = await okIn(app, OWNER, 1, 'GET', `/reports/r/all-documents?from=2026-01-01&to=2026-12-31`);
    const r2 = await okIn(app, OWNER, b2, 'GET', `/reports/r/all-documents?from=2026-01-01&to=2026-12-31`);
    const ids1 = new Set(r1.rows.map((r: { key: string }) => r.key));
    for (const r of r2.rows as { key: string }[]) expect(ids1.has(r.key)).toBe(false);
    const dash = await okIn(app, OWNER, b2, 'GET', '/dashboard?cards=vat');
    expect(dash.businessType.entityType).toBe('company');
  });

  it('copies a client into the other business only on request, without its documents', async () => {
    const one = await finalPaymentRequest(app, 1);
    const copy = await okIn(app, OWNER, 1, 'POST', `/clients/${one.clientId}/copy-to-business`, { businessId: b2 });
    const detail = await okIn(app, OWNER, b2, 'GET', `/clients/${copy.clientId}`);
    expect(detail.client.business_id).toBe(b2);
    expect(detail.balances).toEqual({});
  });

  it('offers only a company when the Ledger already has an עוסק business (one-osek rule)', async () => {
    const list = await okIn(app, OWNER, 1, 'GET', '/businesses');
    expect(list.addableTypes).toEqual(['company']);
    const res = await callIn(app, OWNER, 1, 'POST', '/businesses', {
      entityType: 'osek_murshe',
      nameEn: 'Second Osek',
      nameHe: 'עוסק שני',
      taxId: '123456782',
      addressEn: 'Tel Aviv',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('one_osek_only');
  });

  it('never deletes a business, and a business never changes id (raw SQL)', async () => {
    expect(await sqlError('DELETE FROM businesses WHERE id = ?', b2)).toContain('entity_type_locked');
    expect(await sqlError('UPDATE businesses SET id = 99 WHERE id = ?', b2)).toContain('business_locked');
  });
});
