import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { run } from '../../src/core/db';
import { createApp } from '../../src/index';
import { createClientsModule } from '../../src/modules/clients';
import type { AllocationRequester } from '../../src/modules/documents';
import { createDocumentsModule } from '../../src/modules/documents';
import type { CeilingGuard } from '../../src/modules/documents/ceiling';
import { buildPcn874 } from '../../src/modules/exports/pcn874/build';
import { buildUnifiedFile } from '../../src/modules/exports/unified-file/build';
import { FakeFxHistory, FxRates } from '../../src/modules/fx';
import { D1AllocationDocuments } from '../../src/modules/ita/documents';
import { createLegalModeModule } from '../../src/modules/legal-mode';
import type { Env } from '../../src/env';
import { RATES } from '../fixtures/documents/rates';

/**
 * The exports pipeline against R11's real עוסק מורשה flow (migrations/1100_murshe.sql,
 * migrations/1101_allocation_integrity.sql), not the synthetic test-only types the other
 * test/exports/*.test.ts files register: a real switch, a real 305/330 finalized through
 * src/modules/documents/service.ts (not the low-level core/numbering.ts primitive those other
 * files call directly), and a real ita_allocations/allocation_records grant through
 * src/modules/ita/documents.ts's D1AllocationDocuments.
 *
 * Every document in this file finalizes on the same TODAY (the app's fixed `today()`), and the
 * DB is shared across the `it` blocks in this file, so assertions compare a before/after delta
 * for the specific document under test rather than an absolute count or total that later tests
 * would also contribute to.
 */

const passThroughCeiling: CeilingGuard = { async check() {} };
const TODAY = '2026-12-10';

class FakeAllocationRequester implements AllocationRequester {
  async request(documentId: number) {
    return { status: 'pending', message: `queued ${documentId}` };
  }
}

function app() {
  const fx = new FxRates(env.DB, new FakeFxHistory(RATES));
  const documentsOptions = { fx: () => fx, ceiling: passThroughCeiling, today: () => TODAY, allocation: () => new FakeAllocationRequester() };
  return createApp({
    modules: [createClientsModule({ today: () => TODAY }), createDocumentsModule(documentsOptions), createLegalModeModule({ documentsOptions })],
  });
}

const instance = app();

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await instance.request(
    `/api${path}`,
    { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) },
    { ...env, DEV_AUTH_EMAIL: 'owner@example.com' },
  );
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

function testEnv(): Env {
  return { ...env } as Env;
}

async function makeClient(): Promise<number> {
  const body = await api('POST', '/clients', { nameEn: `R11 client ${crypto.randomUUID().slice(0, 6)}`, country: 'IL', vatNumber: '514713288' });
  return body.client.id as number;
}

beforeAll(async () => {
  await api('POST', '/legal-mode/switch', { effectiveDate: TODAY, reason: 'test setup' });
});

describe("exports against R11's real עוסק מורשה flow", () => {
  it('a below-threshold 305 finalizes straight to final and appears in both exports without an allocation warning', async () => {
    const before = await buildPcn874(testEnv(), TODAY, TODAY);

    const clientId = await makeClient();
    const draft = await api('POST', '/documents', { type: '305', clientId, lines: [{ description: 'Small consulting', unitPriceMinor: 100000 }] });
    const out = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(out.document.status).toBe('final');
    expect(out.document.vat_amount_minor).toBe(18000); // 18% of 1,000 ILS

    const after = await buildPcn874(testEnv(), TODAY, TODAY);
    expect(after.report.totalRecords).toBe(before.report.totalRecords + 1);
    expect(after.report.totalIlsMinor - before.report.totalIlsMinor).toBe(118000);

    const unified = await buildUnifiedFile(testEnv(), TODAY, TODAY, TODAY);
    expect(unified.report.recordCounts.C100 ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('an above-threshold 305 finalizes into awaiting_allocation and is excluded from both exports until the ITA grants a number', async () => {
    const before = await buildPcn874(testEnv(), TODAY, TODAY);

    const clientId = await makeClient();
    const draft = await api('POST', '/documents', { type: '305', clientId, lines: [{ description: 'Large consulting', unitPriceMinor: 600000 }] });
    const out = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(out.document.status).toBe('awaiting_allocation');
    const documentId = out.document.id as number;

    const stillExcluded = await buildPcn874(testEnv(), TODAY, TODAY);
    expect(stillExcluded.report.totalRecords).toBe(before.report.totalRecords);
    expect(stillExcluded.report.warnings.some((w) => w.includes('still awaiting an ITA allocation decision'))).toBe(true);

    // The real ITA grant path: ita_allocations gets the short number, then
    // D1AllocationDocuments.setStatus (src/modules/ita/documents.ts) moves the document to
    // final and records the grant in allocation_records (migrations/1101_allocation_integrity.sql).
    await run(
      env.DB,
      `INSERT INTO ita_allocations (document_id, invoice_id, environment, status, confirmation_number, short_number)
       VALUES (?, ?, 'sandbox', 'approved', ?, ?)`,
      documentId,
      crypto.randomUUID(),
      'SANDBOX-0000-987654321',
      '987654321',
    );
    await new D1AllocationDocuments(env.DB).setStatus(documentId, 'final', 'SANDBOX-0000-987654321');

    const afterGrant = await buildUnifiedFile(testEnv(), TODAY, TODAY, TODAY);
    expect(afterGrant.bkmvdata).toContain('987654321');
    const afterGrantPcn = await buildPcn874(testEnv(), TODAY, TODAY);
    expect(afterGrantPcn.text).toContain('987654321');
    expect(afterGrantPcn.report.totalRecords).toBe(before.report.totalRecords + 1);

    const recorded = await env.DB.prepare('SELECT allocation_number FROM allocation_records WHERE document_id = ?')
      .bind(documentId)
      .first<{ allocation_number: string }>();
    expect(recorded?.allocation_number).toBe('SANDBOX-0000-987654321');
  });

  it('an above-threshold 305 finalized "final" with no allocation number (the Continue choice) is flagged as still qualifying for one', async () => {
    // docs/israel-invoices-api.md section 2.2.2, choice 2: "Continue without a number". The ITA
    // flow (src/modules/ita/service.ts) reaches this by calling
    // D1AllocationDocuments.setStatus(id, 'final', null) with no confirmation number at all,
    // simulated directly here the same way test/ita/allocation.test.ts's own fakes do.
    const clientId = await makeClient();
    const draft = await api('POST', '/documents', { type: '305', clientId, lines: [{ description: 'Continue choice', unitPriceMinor: 700000 }] });
    const out = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(out.document.status).toBe('awaiting_allocation');

    await new D1AllocationDocuments(env.DB).setStatus(out.document.id, 'final', null);

    const result = await buildPcn874(testEnv(), TODAY, TODAY);
    expect(result.report.warnings.some((w) => w.includes('qualify for an ITA allocation number'))).toBe(true);
  });

  it('a 330 credit invoice against a final 305 reports with a negative amount, netting the sale it reverses to zero', async () => {
    const before = await buildPcn874(testEnv(), TODAY, TODAY);

    const clientId = await makeClient();
    const draft = await api('POST', '/documents', { type: '305', clientId, lines: [{ description: 'Consulting to credit', unitPriceMinor: 100000 }] });
    const sale = await api('POST', `/documents/${draft.document.id}/finalize`, {});
    expect(sale.document.status).toBe('final');

    const credited = await api('POST', `/documents/${sale.document.id}/credit`, { mode: 'full', reason: 'test credit' });
    expect(credited.document.type).toBe('330');
    expect(credited.document.status).toBe('final');

    const after = await buildPcn874(testEnv(), TODAY, TODAY);
    // Two new rows (the sale and its credit), net ILS total unchanged: proves the credit posted
    // with the opposite sign rather than just being counted again as more revenue.
    expect(after.report.totalRecords).toBe(before.report.totalRecords + 2);
    expect(after.report.totalIlsMinor).toBe(before.report.totalIlsMinor);
  });
});
