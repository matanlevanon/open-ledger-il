import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuditActor } from '../../src/core/audit';
import { all } from '../../src/core/db';
import { createApp } from '../../src/index';
import { createClientsModule } from '../../src/modules/clients';
import type { AllocationRequester } from '../../src/modules/documents';
import { createDocumentsModule } from '../../src/modules/documents';
import type { CeilingGuard } from '../../src/modules/documents/ceiling';
import { createLegalModeModule } from '../../src/modules/legal-mode';
import { FakeFxHistory, FxRates } from '../../src/modules/fx';
import { RATES } from '../fixtures/documents/rates';

/**
 * R11 (runs/R11-murshe.md): VAT, the allocation threshold and opening R12's allocation request.
 * Every test here runs after the switch to עוסק מורשה, done once in beforeAll the same way the
 * legal-mode tests do (PLAN.md decision 2: the switch happens once, never automatically, never
 * twice).
 */

const passThroughCeiling: CeilingGuard = { async check() {} };
const TODAY = '2026-12-10';

class FakeAllocationRequester implements AllocationRequester {
  calls: number[] = [];
  async request(documentId: number, _actor: AuditActor) {
    this.calls.push(documentId);
    return { status: 'pending', message: 'queued' };
  }
}

const allocation = new FakeAllocationRequester();

function app() {
  const fx = new FxRates(env.DB, new FakeFxHistory(RATES));
  const documentsOptions = { fx: () => fx, ceiling: passThroughCeiling, today: () => TODAY, allocation: () => allocation };
  return createApp({
    modules: [
      createClientsModule({ today: () => TODAY }),
      createDocumentsModule(documentsOptions),
      createLegalModeModule({ documentsOptions }),
    ],
  });
}

const instance = app();

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await instance.request(
    `/api${path}`,
    { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: 'owner@example.com' },
  );
  if (res.status >= 300) {
    const text = await res.text();
    throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  }
  return res.json();
}

async function makeClient(overrides: Record<string, unknown> = {}) {
  const body = await api('POST', '/clients', { nameEn: `Client ${crypto.randomUUID().slice(0, 6)}`, country: 'IL', vatNumber: '514713288', ...overrides });
  return body.client.id as number;
}

beforeAll(async () => {
  await api('POST', '/legal-mode/switch', { effectiveDate: TODAY, reason: 'test setup' });
});

describe('VAT (compute()): the legal mode of the document date, never the type', () => {
  it('charges 18% VAT on a tax invoice once switched', async () => {
    const clientId = await makeClient();
    const draft = await api('POST', '/documents', { type: '305', clientId, lines: [{ description: 'Consulting', unitPriceMinor: 200000 }] });
    const out = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(out.document).toMatchObject({ subtotal_minor: 200000, vat_rate_bp: 1800, vat_amount_minor: 36000, total_minor: 236000 });
  });

  it('charges 0% VAT for a foreign-resident client (section 30(a)(5))', async () => {
    const clientId = await makeClient({ country: 'GB', foreignResident: true, vatNumber: null });
    const draft = await api('POST', '/documents', { type: '305', clientId, lines: [{ description: 'Consulting', unitPriceMinor: 900000 }] });
    const out = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(out.document).toMatchObject({ vat_rate_bp: 0, vat_amount_minor: 0, total_minor: 900000 });
  });

  it('re-prices a plain payment request too: VAT depends on the document date, not the type', async () => {
    const clientId = await makeClient();
    const draft = await api('POST', '/documents', { type: 'PR', clientId, lines: [{ description: 'Retainer', unitPriceMinor: 50000 }] });
    const out = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(out.document).toMatchObject({ vat_rate_bp: 1800, vat_amount_minor: 9000, total_minor: 59000 });
  });
});

describe('needsAllocation and opening R12s allocation request (docs/israel-invoices-api.md §1 and §7)', () => {
  it('exactly 5,000.00 before VAT does not need a number: finalize goes straight to final', async () => {
    const clientId = await makeClient();
    const draft = await api('POST', '/documents', { type: '305', clientId, lines: [{ description: 'Exactly at the line', unitPriceMinor: 500000 }] });
    const before = allocation.calls.length;
    const out = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(out.document.status).toBe('final');
    expect(out.already_final).toBe(false);
    expect(allocation.calls.length).toBe(before);
  });

  it('5,000.01 before VAT needs a number: finalize stops at awaiting_allocation and opens the request', async () => {
    const clientId = await makeClient();
    const draft = await api('POST', '/documents', { type: '305', clientId, lines: [{ description: 'One agora over', unitPriceMinor: 500001 }] });
    const out = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(out.document.status).toBe('awaiting_allocation');
    expect(out.document.number).not.toBeNull();
    expect(allocation.calls).toContain(out.document.id);
  });

  it('never needs a number below the threshold even for a large 300 (not a tax-invoice type)', async () => {
    const clientId = await makeClient();
    const draft = await api('POST', '/documents', { type: '300', clientId, lines: [{ description: 'Large project', unitPriceMinor: 5000000 }] });
    const before = allocation.calls.length;
    const out = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(out.document.status).toBe('final');
    expect(allocation.calls.length).toBe(before);
  });

  it('a foreign client above the threshold still needs no number: 0% VAT never qualifies', async () => {
    const clientId = await makeClient({ country: 'GB', foreignResident: true, vatNumber: null });
    const draft = await api('POST', '/documents', { type: '305', clientId, lines: [{ description: 'Export', unitPriceMinor: 900000 }] });
    const before = allocation.calls.length;
    const out = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(out.document.status).toBe('final');
    expect(allocation.calls.length).toBe(before);
  });
});

describe('VAT law amendment 37: client ID or VAT number required above the allocation threshold', () => {
  it('refuses to finalize a tax invoice above the threshold when the client has no VAT number or ID', async () => {
    const clientId = await makeClient({ vatNumber: null, companyId: null });
    const draft = await api('POST', '/documents', { type: '305', clientId, lines: [{ description: 'One agora over', unitPriceMinor: 500001 }] });
    const res = await instance.request(
      `/api/documents/${draft.document.id}/finalize`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      { ...env, DEV_AUTH_EMAIL: 'owner@example.com' },
    );
    expect(res.status).toBe(400);
    const body = await res.json<any>();
    expect(body.error.message).toMatch(/VAT number or ID/);
    const stillDraft = await api('GET', `/documents/${draft.document.id}`);
    expect(stillDraft.document.status).toBe('draft');
  });

  it('a company id (no VAT number) above the threshold satisfies amendment 37', async () => {
    const clientId = await makeClient({ vatNumber: null, companyId: '515738264' });
    const draft = await api('POST', '/documents', { type: '305', clientId, lines: [{ description: 'One agora over', unitPriceMinor: 500001 }] });
    const out = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(out.document.status).toBe('awaiting_allocation');
  });

  it('the same missing-VAT-number client is fine below the threshold: amendment 37 only bites above it', async () => {
    const clientId = await makeClient({ vatNumber: null, companyId: null });
    const draft = await api('POST', '/documents', { type: '305', clientId, lines: [{ description: 'Well under the line', unitPriceMinor: 100000 }] });
    const out = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(out.document.status).toBe('final');
  });
});

describe('recordPayment issues 320, not 400, once in עוסק מורשה', () => {
  it('a 300 paid in full becomes a 320 with VAT', async () => {
    const clientId = await makeClient();
    const draft = await api('POST', '/documents', { type: '300', clientId, lines: [{ description: 'Sprint', unitPriceMinor: 100000 }] });
    const demand = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(demand.document.total_minor).toBe(118000);

    const receipt = await api('POST', `/documents/${demand.document.id}/record-payment`, {
      payments: [{ method: 'bank_transfer', paidOn: TODAY, amountMinor: 118000 }],
    });
    expect(receipt.document.type).toBe('320');
    expect(receipt.document).toMatchObject({ status: 'final', subtotal_minor: 100000, vat_amount_minor: 18000, total_minor: 118000 });

    const links = await all(
      env.DB,
      "SELECT amount_minor FROM document_links WHERE source_id = ? AND kind = 'payment'",
      demand.document.id,
    );
    expect(links).toEqual([{ amount_minor: 118000 }]);
  });
});

/**
 * R11 fix 1 (runs/R11-murshe.md): the switch must not close receipts entirely. 400 stays enabled
 * and numbers from a fresh series once switched, so a receipt against a standalone 305 stays
 * possible alongside the combined 320.
 */
describe('fix 1: a plain receipt (400) stays possible against a standalone 305', () => {
  it('400 is still enabled and open with its own series after the switch', async () => {
    const types = await all<{ code: string; enabled: number }>(env.DB, "SELECT code, enabled FROM document_types WHERE code = '400'");
    expect(types[0]?.enabled).toBe(1);
    const series = await all<{ id: string; doc_type: string; closed_at: string | null }>(
      env.DB,
      "SELECT id, doc_type, closed_at FROM series WHERE doc_type = '400' AND closed_at IS NULL",
    );
    expect(series).toHaveLength(1);
    expect(series[0]?.id).not.toBe('400'); // the original פטור series, now closed
  });

  it('a 305 paid in full becomes a 400 receipt, not a 320', async () => {
    const clientId = await makeClient();
    const draft = await api('POST', '/documents', { type: '305', clientId, lines: [{ description: 'Standalone invoice', unitPriceMinor: 100000 }] });
    const invoice = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(invoice.document).toMatchObject({ status: 'final', total_minor: 118000 });

    const receipt = await api('POST', `/documents/${invoice.document.id}/record-payment`, {
      payments: [{ method: 'bank_transfer', paidOn: TODAY, amountMinor: 118000 }],
    });
    expect(receipt.document.type).toBe('400');
    expect(receipt.document).toMatchObject({ status: 'final', total_minor: 118000 });

    const receiptRow = await all<{ series_id: string }>(env.DB, 'SELECT series_id FROM documents WHERE id = ?', receipt.document.id);
    expect(receiptRow[0]?.series_id).not.toBe('400');
  });
});
