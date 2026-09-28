import { unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeWindows1255 } from '../../src/modules/exports';
import { CLIENT_VAT } from '../ita/helpers';
import { buildE2eApp, connectIta, makeClient, ok } from './helpers';

/**
 * test/exports/r11-integration.test.ts calls `buildUnifiedFile`/`buildPcn874` directly as
 * functions; test/exports/routes.test.ts hits the real HTTP download route but against
 * documents that were never actually issued through the real finalize pipeline in the same test.
 * This end-to-end test does the whole chain over HTTP: issue and finalize real documents
 * (a עוסק פטור receipt, then a real switch, then a real עוסק מורשה tax invoice that clears ITA
 * allocation), download the unified file and PCN874 export as an owner would, unzip the actual
 * bytes, and check the real document numbers and the real granted allocation number are in there.
 */

const TODAY = '2026-11-20';

const app = buildE2eApp({ today: () => TODAY });

let receiptNumber: number;
let invoiceNumber: number;
let allocationNumber: string;

beforeAll(async () => {
  const client = await makeClient(app, { vatNumber: CLIENT_VAT });

  const receiptDraft = await ok(app, 'POST', '/documents', {
    type: '400',
    clientId: client,
    payments: [{ method: 'bank_transfer', paidOn: TODAY, amountMinor: 1000000 }],
  });
  const receipt = await ok(app, 'POST', `/documents/${receiptDraft.document.id}/finalize`, {});
  expect(receipt.document.status).toBe('final');
  receiptNumber = receipt.document.number;

  await ok(app, 'POST', '/legal-mode/switch', { effectiveDate: TODAY, reason: 'export test' });
  await connectIta(app);

  const invoiceDraft = await ok(app, 'POST', '/documents', { type: '305', clientId: client, lines: [{ description: 'Exported invoice', unitPriceMinor: 600000 }] });
  const invoice = await ok(app, 'POST', `/documents/${invoiceDraft.document.id}/finalize`, {});
  expect(invoice.document.status).toBe('final'); // auto-granted synchronously inside finalize
  invoiceNumber = invoice.document.number;
  const fullAllocationNumber = invoice.document.allocation_number as string;
  expect(fullAllocationNumber).toMatch(/^\d+$/);
  // The unified file and PCN874 print only the rightmost 9 digits under "מספר הקצאה:"
  // (docs/israel-invoices-api.md section 6/10), not the full confirmation number.
  allocationNumber = fullAllocationNumber.slice(-9);
});

describe('the unified file and PCN874 downloads, over real HTTP, after a real document lifecycle', () => {
  it('GET /exports/unified-file zips a real BKMVDATA.TXT containing both real document numbers', async () => {
    const res = await app.instance.request(
      `/api/exports/unified-file?from=${TODAY}&to=${TODAY}`,
      { method: 'GET' },
      { ...app.ienv, DEV_AUTH_EMAIL: 'owner@example.com' },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');

    const bytes = new Uint8Array(await res.arrayBuffer());
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).sort()).toEqual(['OPENFRMT/BKMVDATA.TXT', 'OPENFRMT/INI.TXT']);
    const bkmvdata = decodeWindows1255(entries['OPENFRMT/BKMVDATA.TXT']!);
    expect(bkmvdata).toContain(String(receiptNumber));
    expect(bkmvdata).toContain(String(invoiceNumber));
    expect(bkmvdata).toContain(allocationNumber);
  });

  it('GET /exports/pcn874 lists only the real מורשה tax invoice, with its real allocation number, not the פטור receipt', async () => {
    const res = await app.instance.request(
      `/api/exports/pcn874?from=${TODAY}&to=${TODAY}`,
      { method: 'GET' },
      { ...app.ienv, DEV_AUTH_EMAIL: 'owner@example.com' },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(allocationNumber);
    // Only the מורשה tax invoice qualifies for PCN874 (document_types.modes = 'murshe'); the
    // עוסק פטור receipt never appears as its own row, so there is exactly one data row here.
    expect(text.match(/^R874/gm)).toHaveLength(1);
  });

  it('is gated by the unified_file/pcn874 features, off by default for an accountant without them', async () => {
    const { env } = await import('cloudflare:workers');
    await env.DB.prepare("INSERT INTO users (email, role) VALUES ('cpa-no-exports@example.com', 'accountant')").run();
    const res = await app.instance.request(
      `/api/exports/unified-file?from=${TODAY}&to=${TODAY}`,
      { method: 'GET' },
      { ...app.ienv, DEV_AUTH_EMAIL: 'cpa-no-exports@example.com' },
    );
    expect(res.status).toBe(403);
  });
});
