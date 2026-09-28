import { describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { finalizeDocument } from '../../../src/core/numbering';
import { incomeReport } from '../../../src/modules/reports';
import { OWNER_ACTOR, db, makeDraft } from '../../helpers';

async function makeClient(nameEn: string): Promise<number> {
  const { lastRowId } = await run(db(), 'INSERT INTO clients (name_en) VALUES (?)', nameEn);
  return lastRowId;
}

async function finalizeWithClient(seriesId: string, totalMinor: number, clientId: number, currency = 'ILS'): Promise<number> {
  const id = await makeDraft({ seriesId, totalMinor, currency });
  await run(db(), 'UPDATE documents SET client_id = ? WHERE id = ?', clientId, id);
  await finalizeDocument(db(), id, { actor: OWNER_ACTOR });
  return id;
}

describe('incomeReport: income by month, client and currency (runs/R08-reports.md)', () => {
  it('counts a final receipt as income, grouped by month, client and currency', async () => {
    const client = await makeClient('Acme Ltd');
    await finalizeWithClient('400', 100000, client);

    const report = await incomeReport(db(), '2026-10-01', '2026-10-31');
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ clientName: 'Acme Ltd', currency: 'ILS', amountMinor: 100000, amountIlsMinor: 100000 });
    expect(report.byMonth).toEqual([{ month: '2026-10', totalIlsMinor: 100000 }]);
    expect(report.byClient).toEqual([{ clientId: client, clientName: 'Acme Ltd', totalIlsMinor: 100000 }]);
    expect(report.byCurrency).toEqual([{ currency: 'ILS', totalMinor: 100000, totalIlsMinor: 100000 }]);
    expect(report.totalIlsMinor).toBe(100000);
  });

  it('nets a credit receipt against the sale it reverses', async () => {
    const client = await makeClient('Beta Co');
    await finalizeWithClient('400', 50000, client);
    await finalizeWithClient('405', -20000, client);

    const report = await incomeReport(db(), '2026-10-01', '2026-10-31');
    const beta = report.byClient.find((c) => c.clientName === 'Beta Co');
    expect(beta?.totalIlsMinor).toBe(30000);
  });

  it('excludes payment requests and quotes: not bookkeeping income (docs/legal-requirements.md)', async () => {
    const client = await makeClient('Gamma Inc');
    await finalizeWithClient('PR', 999999, client);

    const report = await incomeReport(db(), '2026-10-01', '2026-10-31');
    expect(report.rows.some((r) => r.clientName === 'Gamma Inc')).toBe(false);
  });

  it('excludes a document outside the requested date range', async () => {
    const client = await makeClient('Delta LLC');
    await finalizeWithClient('400', 70000, client);

    const report = await incomeReport(db(), '2020-01-01', '2020-01-31');
    expect(report.rows.some((r) => r.clientName === 'Delta LLC')).toBe(false);
  });

  /** R17 task 7: a document uploaded from another system counts as income too, labeled by source. */
  it('counts an uploaded external document as income, labeled "Issued in <source>"', async () => {
    await run(
      db(),
      `INSERT INTO external_documents (source, original_number, doc_type, issue_date, client_name_text, currency,
         amount_before_vat_minor, vat_amount_minor, total_minor, total_ils_minor, paid_status, r2_key, sha256)
       VALUES ('wave', 'income-test-1', 'Invoice', '2026-10-15', 'Old System Client', 'ILS', 5000, 0, 5000, 5000, 'paid', 'k', 'h')`,
    );
    const report = await incomeReport(db(), '2026-10-01', '2026-10-31');
    const row = report.rows.find((r) => r.clientName === 'Old System Client');
    expect(row).toMatchObject({ typeNameEn: 'Issued in wave', externalSource: 'wave', amountMinor: 5000, amountIlsMinor: 5000 });
    expect(report.totalIlsMinor).toBeGreaterThanOrEqual(5000);
  });

  it('leaves an imported pro forma or payment request out of income, its receipt is the income', async () => {
    await run(
      db(),
      `INSERT INTO external_documents (source, original_number, doc_type, issue_date, client_name_text, currency,
         amount_before_vat_minor, vat_amount_minor, total_minor, total_ils_minor, paid_status, r2_key, sha256)
       VALUES ('sumit', 'income-pf-1', 'Pro Forma Invoice', '2026-11-15', 'Double Co', 'ILS', 7000, 0, 7000, 7000, 'paid', 'k', 'h'),
              ('sumit', 'income-pr-1', 'דרישת תשלום', '2026-11-15', 'Double Co', 'ILS', 7000, 0, 7000, 7000, 'paid', 'k', 'h'),
              ('sumit', 'income-ir-1', 'Invoice/Receipt', '2026-11-20', 'Double Co', 'ILS', 7000, 0, 7000, 7000, 'paid', 'k', 'h')`,
    );
    const report = await incomeReport(db(), '2026-11-01', '2026-11-30');
    const rows = report.rows.filter((r) => r.clientName === 'Double Co');
    expect(rows.map((r) => r.displayNumber)).toEqual(['income-ir-1']);
  });
});
