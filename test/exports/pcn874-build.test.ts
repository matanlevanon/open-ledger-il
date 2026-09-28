import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/core/db';
import { finalizeDocument } from '../../src/core/numbering';
import { buildPcn874 } from '../../src/modules/exports/pcn874/build';
import type { Env } from '../../src/env';
import { OWNER_ACTOR, db, makeDraft } from '../helpers';

const CLIENT_VAT = '514713288';

function testEnv(): Env {
  return { ...env } as Env;
}

async function makeClient(nameEn: string, vatNumber: string | null = null): Promise<number> {
  const { lastRowId } = await run(db(), 'INSERT INTO clients (name_en, vat_number) VALUES (?, ?)', nameEn, vatNumber);
  return lastRowId;
}

/** Makes a draft on the given series look like a tax invoice: same shape as the real 305/320
 * (`modes = 'murshe'`, `kind = 'invoice'`, buildPcn874's own selection criteria), just under a
 * test-only type code so this file can finalize one directly through core/numbering.ts's
 * low-level primitive instead of the full R11 switch + documents/service.ts flow that
 * test/exports/r11-integration.test.ts exercises end to end. */
async function registerTaxInvoiceType(code: string): Promise<void> {
  await run(
    db(),
    `INSERT INTO document_types (code, name_en, name_he, kind, modes, bookkeeping, sort_order, enabled)
     VALUES (?, 'Test tax invoice', 'בדיקה', 'invoice', 'murshe', 1, 999, 1)`,
    code,
  );
  await run(db(), `INSERT INTO series (id, doc_type, name_en) VALUES (?, ?, 'Test tax invoice series')`, code, code);
}

async function finalizeInvoice(
  seriesId: string,
  opts: { clientId?: number; date?: string; subtotalMinor: number; vatMinor: number },
): Promise<number> {
  const total = opts.subtotalMinor + opts.vatMinor;
  const id = await makeDraft({ seriesId, totalMinor: total });
  await run(
    db(),
    'UPDATE documents SET client_id = ?, date = ?, subtotal_minor = ?, vat_amount_minor = ? WHERE id = ?',
    opts.clientId ?? null,
    opts.date ?? '2026-10-01',
    opts.subtotalMinor,
    opts.vatMinor,
    id,
  );
  await finalizeDocument(db(), id, { actor: OWNER_ACTOR });
  return id;
}

describe('buildPcn874 (docs/israel-invoices-api.md section 10, runs/R13-exports.md tests: "allocation number column")', () => {
  it('lists one row per final tax invoice in the period, with the allocation number when approved', async () => {
    await registerTaxInvoiceType('T305');
    const client = await makeClient('Acme Ltd', CLIENT_VAT);
    const docId = await finalizeInvoice('T305', { clientId: client, date: '2026-11-05', subtotalMinor: 500000, vatMinor: 90000 });
    await run(
      db(),
      `INSERT INTO ita_allocations (document_id, invoice_id, environment, status, confirmation_number, short_number)
       VALUES (?, ?, 'sandbox', 'approved', ?, ?)`,
      docId,
      crypto.randomUUID(),
      'SANDBOX-0000-123456789',
      '123456789',
    );

    const result = await buildPcn874(testEnv(), '2026-11-05', '2026-11-05');
    expect(result.report.totalRecords).toBe(1);
    expect(result.text.trim()).toContain('123456789');
    expect(result.report.warnings.some((w) => w.includes('allocation number'))).toBe(false);
  });

  // "Flags a qualifying invoice with no allocation number yet" needs a real 305/320/332 code:
  // needsAllocation() (src/modules/documents/allocation.ts) checks the document's actual type
  // against a fixed set of real codes, so a synthetic type like the ones this file registers
  // never qualifies. That scenario lives in test/exports/r11-integration.test.ts, which runs the
  // real R11 switch and a real type instead.

  it('excludes receipts and quotes: PCN874 covers tax invoices, not every bookkeeping document', async () => {
    const client = await makeClient('Gamma Inc');
    await finalizeSaleForExclusionCheck('400', client);

    const result = await buildPcn874(testEnv(), '2026-10-01', '2026-10-01');
    expect(result.report.totalRecords).toBe(0);
    expect(result.text).toBe('');
  });

  it('excludes an invoice outside the requested period', async () => {
    await registerTaxInvoiceType('T332');
    const client = await makeClient('Delta LLC');
    await finalizeInvoice('T332', { clientId: client, date: '2020-01-15', subtotalMinor: 10000, vatMinor: 1800 });

    // A narrow, otherwise-unused window: the 2020-01-15 invoice must not appear, and this must
    // not overlap the November dates the other tests in this file use.
    const result = await buildPcn874(testEnv(), '2026-12-01', '2026-12-31');
    expect(result.report.totalRecords).toBe(0);
  });
});

async function finalizeSaleForExclusionCheck(seriesId: string, clientId: number): Promise<void> {
  const id = await makeDraft({ seriesId, totalMinor: 10000 });
  await run(db(), 'UPDATE documents SET client_id = ?, date = ? WHERE id = ?', clientId, '2026-10-01', id);
  await finalizeDocument(db(), id, { actor: OWNER_ACTOR });
}
