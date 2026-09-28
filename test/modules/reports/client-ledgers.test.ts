import { describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { finalizeDocument } from '../../../src/core/numbering';
import { clientLedgersReport } from '../../../src/modules/reports';
import { OWNER_ACTOR, db, makeDraft } from '../../helpers';

async function makeClient(nameEn: string): Promise<number> {
  const { lastRowId } = await run(db(), 'INSERT INTO clients (name_en) VALUES (?)', nameEn);
  return lastRowId;
}

async function finalizeWithClient(
  seriesId: string,
  totalMinor: number,
  clientId: number,
  extra: { currency?: string; totalIlsMinor?: number } = {},
): Promise<number> {
  const id = await makeDraft({ seriesId, totalMinor, currency: extra.currency ?? 'ILS' });
  await run(db(), 'UPDATE documents SET client_id = ? WHERE id = ?', clientId, id);
  if (extra.totalIlsMinor !== undefined) {
    await run(db(), 'UPDATE documents SET total_ils_minor = ? WHERE id = ?', extra.totalIlsMinor, id);
  }
  await finalizeDocument(db(), id, { actor: OWNER_ACTOR });
  return id;
}

/** R16 task 11: per-client ledger (תוספת ה׳) for the monthly accountant pack and reports. */
describe('clientLedgersReport', () => {
  it('lists every document and payment for every client active in the period, date ordered, with a running balance', async () => {
    const acme = await makeClient('Acme Ltd');
    const beta = await makeClient('Beta Co');
    await finalizeWithClient('400', 100000, acme);
    await finalizeWithClient('400', 50000, beta);

    const report = await clientLedgersReport(db(), '2026-10-01', '2026-10-31');
    expect(report.clients.map((c) => c.clientName)).toEqual(['Acme Ltd', 'Beta Co']);
    const acmeRow = report.clients.find((c) => c.clientName === 'Acme Ltd')!;
    expect(acmeRow.ledger.entries).toHaveLength(1);
    expect(acmeRow.ledger.entries[0]).toMatchObject({ debit_minor: 100000, currency: 'ILS', balance_minor: 100000 });
  });

  it('tracks a running balance in ILS alongside the document currency', async () => {
    const client = await makeClient('Ils Co');
    await finalizeWithClient('400', 100000, client); // ILS: both balances move together

    const report = await clientLedgersReport(db(), '2026-10-01', '2026-10-31');
    const row = report.clients.find((c) => c.clientName === 'Ils Co')!;
    expect(row.ledger.entries[0]).toMatchObject({ balance_minor: 100000, balance_ils_minor: 100000 });
    expect(row.closingIlsMinor).toBe(100000);
  });

  it('leaves an open foreign-currency demand out of the ILS running balance, per no revaluation of open balances', async () => {
    const client = await makeClient('Foreign Co');
    await finalizeWithClient('PR', 50000, client, { currency: 'USD' }); // no total_ils_minor: not yet shown in ILS

    const report = await clientLedgersReport(db(), '2026-10-01', '2026-10-31');
    const row = report.clients.find((c) => c.clientName === 'Foreign Co')!;
    expect(row.ledger.entries[0]).toMatchObject({ currency: 'USD', debit_minor: 50000, balance_minor: 50000 });
    expect(row.ledger.entries[0]!.debit_ils_minor).toBeNull();
    expect(row.closingIlsMinor).toBe(0);
  });

  it('counts a foreign-currency document with a fixed ILS amount in the ILS running balance', async () => {
    const client = await makeClient('Fixed Rate Co');
    await finalizeWithClient('400', 50000, client, { currency: 'USD', totalIlsMinor: 185000 });

    const report = await clientLedgersReport(db(), '2026-10-01', '2026-10-31');
    const row = report.clients.find((c) => c.clientName === 'Fixed Rate Co')!;
    expect(row.ledger.entries[0]).toMatchObject({ currency: 'USD', debit_minor: 50000, debit_ils_minor: 185000, balance_ils_minor: 185000 });
  });

  it('excludes a client with no bookkeeping activity in the period', async () => {
    await makeClient('Quiet Co');
    const report = await clientLedgersReport(db(), '2026-10-01', '2026-10-31');
    expect(report.clients.some((c) => c.clientName === 'Quiet Co')).toBe(false);
  });

  it('excludes quotes: not bookkeeping, same rule as clientLedger itself', async () => {
    const client = await makeClient('Quote Only Co');
    await finalizeWithClient('QT', 40000, client);
    const report = await clientLedgersReport(db(), '2026-10-01', '2026-10-31');
    expect(report.clients.some((c) => c.clientName === 'Quote Only Co')).toBe(false);
  });
});
