import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { FakeDriveSource } from '../../../src/modules/expenses/fakes';
import type { Extractor } from '../../../src/modules/expenses/extractor';
import { handleLedgerEmail, type IncomingEmail, MAX_EMAIL_BYTES } from '../../../src/modules/expenses/inbox';
import type { Deps } from '../../../src/modules/expenses/service';
import { FakeFxHistory, FxRates } from '../../../src/modules/fx';

/** R35 task 3: a Ledger on its own domain takes email straight from Email Routing. */

const extractor: Extractor = {
  extract: async () => ({ supplierName: 'Own Domain Supplier', supplierId: null, documentNumber: null, date: '2026-10-02', currency: 'ILS', amount: '50.00', vatAmount: null, documentType: null }),
};
const deps: Deps = { drive: new FakeDriveSource(), extractor, fx: new FxRates(env.DB, new FakeFxHistory({})) };
const testEnv = { ...env, OWNER_EMAIL: 'owner@example.com' };

function message(raw: string, from: string, rawSize?: number): IncomingEmail & { rejected: string | null } {
  const bytes = new TextEncoder().encode(raw);
  const m = {
    from,
    rawSize: rawSize ?? bytes.byteLength,
    raw: new Blob([bytes]).stream(),
    rejected: null as string | null,
    setReject(reason: string) {
      m.rejected = reason;
    },
  };
  return m;
}

const pdfMail = (subject: string) =>
  [
    'From: Shop <shop@vendor.test>',
    'To: receipts@acme.test',
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="x"',
    '',
    '--x',
    'Content-Type: application/pdf; name="r.pdf"',
    'Content-Disposition: attachment; filename="r.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(`%PDF-1.4 ${subject}`),
    '--x--',
    '',
  ].join('\r\n');

describe('email() on the Ledger Worker', () => {
  it('files an allowed sender\'s receipt with no signature', async () => {
    const subject = `Own domain ${Date.now()}`;
    const m = message(pdfMail(subject), 'owner@example.com');
    await handleLedgerEmail(m, testEnv, deps);
    expect(m.rejected).toBeNull();
    const rows = await env.DB.prepare('SELECT * FROM expenses WHERE notes LIKE ?').bind(`%${subject}%`).all();
    expect(rows.results).toHaveLength(1);
  });

  it('applies the same sender rule', async () => {
    const subject = `Own domain stranger ${Date.now()}`;
    const m = message(pdfMail(subject), 'stranger@else.test');
    await handleLedgerEmail(m, testEnv, deps);
    expect(m.rejected).toBeNull();
    const rows = await env.DB.prepare('SELECT * FROM expenses WHERE notes LIKE ?').bind(`%${subject}%`).all();
    expect(rows.results).toHaveLength(0);
  });

  it('rejects over 20 MB, and everything in the demo', async () => {
    const big = message(pdfMail('big'), 'owner@example.com', MAX_EMAIL_BYTES + 1);
    await handleLedgerEmail(big, testEnv, deps);
    expect(big.rejected).toBe('Too large');
    const demo = message(pdfMail('demo'), 'owner@example.com');
    await handleLedgerEmail(demo, { ...testEnv, DEMO_MODE: '1' }, deps);
    expect(demo.rejected).toBe('Unknown address');
  });
});
