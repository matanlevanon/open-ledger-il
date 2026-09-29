import { env } from 'cloudflare:workers';
import { unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { run } from '../../src/core/db';
import { finalizeDocument } from '../../src/core/numbering';
import { decodeIso88598 } from '../../src/modules/exports/encoding';
import { buildUnifiedFile, fileDocNumber, validIsraeliId } from '../../src/modules/exports/unified-file/build';
import type { Env } from '../../src/env';
import { OWNER_ACTOR, db, makeDraft } from '../helpers';

// Documents share series across the tests in this file, and a series refuses a final document
// dated before its last one, so every test uses a later date than the one before it.

const VAT = '123456782';
const NOW = new Date('2026-12-15T08:30:00Z'); // 10:30 in Israel

function testEnv(overrides: Partial<Env> = {}): Env {
  return { ...env, SOFTWARE_REGISTRATION_NUMBER: '12345678', SOFTWARE_PRODUCER_VAT: '987654321', ...overrides } as Env;
}

async function makeClient(nameEn: string, opts: { nameHe?: string; vat?: string; country?: string } = {}): Promise<number> {
  const { lastRowId } = await run(
    db(),
    'INSERT INTO clients (name_en, name_he, vat_number, country) VALUES (?, ?, ?, ?)',
    nameEn,
    opts.nameHe ?? null,
    opts.vat ?? null,
    opts.country ?? 'IL',
  );
  return lastRowId;
}

async function issue(
  seriesId: string,
  date: string,
  opts: { clientId?: number; totalMinor?: number; payments?: { method?: string; amountMinor: number; paidOn?: string }[]; lines?: { description: string; unitPriceMinor: number; quantityMilli?: number }[] } = {},
): Promise<number> {
  const id = await makeDraft({ seriesId, totalMinor: opts.totalMinor, payments: opts.payments, lines: opts.lines });
  await run(db(), 'UPDATE documents SET client_id = ?, date = ? WHERE id = ?', opts.clientId ?? null, date, id);
  await finalizeDocument(db(), id, { actor: OWNER_ACTOR });
  return id;
}

const lines = (text: string) => text.split('\r\n').filter(Boolean);

beforeAll(async () => {
  await run(db(), 'INSERT OR IGNORE INTO business_profile (id) VALUES (1)');
  await run(db(), "UPDATE business_profile SET tax_id = ?, name_he = 'עסק לדוגמה', address_he = 'הרצל 1 תל אביב' WHERE id = 1", VAT);
});

describe('unified file build (instructions 1.31)', () => {
  it('writes A100 first, Z900 last, and counts every record in Z900 and INI', async () => {
    const client = await makeClient('Acme Ltd', { nameHe: 'אקמה בע"מ', vat: '514713288' });
    await issue('400', '2027-01-05', { clientId: client, totalMinor: 100000, payments: [{ amountMinor: 100000, method: 'bank_transfer' }] });

    const result = await buildUnifiedFile(testEnv(), '2027-01-05', '2027-01-05', { now: NOW, mainId: '123456789012345' });
    const data = lines(result.bkmvdata);
    expect(data[0]!.startsWith('A100')).toBe(true);
    expect(data.at(-1)!.startsWith('Z900')).toBe(true);
    expect(data.map((l) => l.slice(0, 4))).toEqual(['A100', 'B110', 'C100', 'D120', 'Z900']);
    data.forEach((l, i) => expect(l.slice(4, 13)).toBe(String(i + 1).padStart(9, '0')));

    const z900 = data.at(-1)!;
    expect(z900.slice(45, 60)).toBe('000000000000005');
    const ini = lines(result.iniText);
    expect(ini[0]).toHaveLength(466);
    expect(ini[0]!.slice(9, 24)).toBe('000000000000005');
    expect(ini[0]!.slice(24, 33)).toBe(VAT);
    expect(ini[0]!.slice(33, 48)).toBe('123456789012345');
    expect(ini[0]!.slice(48, 56)).toBe('&OF1.31&');
    expect(ini[0]!.slice(56, 64)).toBe('12345678');
    // One summary row per record type in BKMVDATA.TXT, none for absent types.
    expect(ini.slice(1).map((l) => l.slice(0, 4))).toEqual(['A100', 'B110', 'C100', 'D120', 'Z900']);
    expect(ini.find((l) => l.startsWith('C100'))).toBe('C100000000000000001');
    expect(ini.find((l) => l.startsWith('Z900'))).toBe('Z900000000000000001');
  });

  it('writes a receipt header with the customer, amounts in shekels and a bank transfer payment line', async () => {
    const client = await makeClient('Beta Co', { nameHe: 'בטא', vat: '514713288' });
    await issue('400', '2027-01-10', { clientId: client, totalMinor: 250000, payments: [{ amountMinor: 250000, method: 'bank_transfer', paidOn: '2027-01-10' }] });

    const result = await buildUnifiedFile(testEnv(), '2027-01-10', '2027-01-10', { now: NOW });
    const c100 = lines(result.bkmvdata).find((l) => l.startsWith('C100'))!;
    expect(c100).toHaveLength(444);
    expect(c100.slice(22, 25)).toBe('400');
    expect(c100.slice(57, 107).trim()).toBe('בטא');
    expect(c100.slice(252, 261)).toBe('514713288');
    expect(c100.slice(347, 362)).toBe('+00000000250000');
    expect(c100.slice(400, 408)).toBe('20270110');

    const d120 = lines(result.bkmvdata).find((l) => l.startsWith('D120'))!;
    expect(d120).toHaveLength(222);
    expect(d120.slice(25, 45).trim()).toBe(c100.slice(25, 45).trim());
    expect(d120[49]).toBe('4');
    expect(d120.slice(103, 118)).toBe('+00000000250000');
    expect(result.summary.documentTypes.find((t) => t.code === 400)).toMatchObject({ count: 1, totalIlsMinor: 250000 });
  });

  it('writes a credit receipt as a receipt with negative amounts', async () => {
    const client = await makeClient('Gamma');
    const id = await issue('405', '2027-01-15', { clientId: client, totalMinor: -30000, payments: [{ amountMinor: 30000, method: 'cash' }] });
    const { number } = (await db().prepare('SELECT number FROM documents WHERE id = ?').bind(id).first<{ number: number }>())!;

    const result = await buildUnifiedFile(testEnv(), '2027-01-15', '2027-01-15', { now: NOW });
    const c100 = lines(result.bkmvdata).find((l) => l.startsWith('C100'))!;
    expect(c100.slice(22, 25)).toBe('400');
    // The credit receipt series counts from 1 like the receipt series, so it carries its letters (section 2.4 ד).
    expect(c100.slice(25, 45).trim()).toBe(`CR${number}`);
    expect(c100.slice(347, 362)).toBe('-00000000030000');
    const d120 = lines(result.bkmvdata).find((l) => l.startsWith('D120'))!;
    expect(d120[49]).toBe('1');
    expect(d120.slice(103, 118)).toBe('-00000000030000');
  });

  it('leaves quotes and payment requests out: they have no code in appendix 1', async () => {
    const client = await makeClient('Delta');
    await issue('QT', '2027-01-20', { clientId: client, totalMinor: 100000 });
    await issue('PR', '2027-01-20', { clientId: client, totalMinor: 100000 });

    const result = await buildUnifiedFile(testEnv(), '2027-01-20', '2027-01-20', { now: NOW });
    expect(result.report.recordCounts.C100 ?? 0).toBe(0);
    expect(lines(result.bkmvdata).map((l) => l.slice(0, 4))).toEqual(['A100', 'Z900']);
  });

  it('writes the pro forma (300) with its lines as D110', async () => {
    const client = await makeClient('Epsilon');
    await issue('300', '2027-01-25', {
      clientId: client,
      lines: [
        { description: 'Strategy', unitPriceMinor: 200000, quantityMilli: 1500 },
        { description: 'Ads', unitPriceMinor: 50000 },
      ],
    });

    const result = await buildUnifiedFile(testEnv(), '2027-01-25', '2027-01-25', { now: NOW });
    const d110 = lines(result.bkmvdata).filter((l) => l.startsWith('D110'));
    expect(d110).toHaveLength(2);
    expect(d110[0]).toHaveLength(339);
    expect(d110[0]!.slice(22, 25)).toBe('300');
    expect(d110[0]!.slice(45, 49)).toBe('0001');
    expect(d110[0]!.slice(223, 240)).toBe('+0000000000015000');
    expect(d110[0]!.slice(270, 285)).toBe('+00000000300000');
  });

  it('leaves out documents dated outside the period', async () => {
    const result = await buildUnifiedFile(testEnv(), '2030-01-01', '2030-01-31', { now: NOW });
    expect(result.report.recordCounts.C100 ?? 0).toBe(0);
  });

  it('zips OPENFRMT/<vat>.<yy>/<MMDDhhmm>/INI.TXT and BKMVDATA.zip, in ISO-8859-8', async () => {
    const result = await buildUnifiedFile(testEnv(), '2027-01-01', '2027-01-31', { now: NOW });
    const entries = unzipSync(result.zip);
    const dir = 'OPENFRMT/12345678.26/12151030';
    expect(Object.keys(entries).sort()).toEqual([`${dir}/BKMVDATA.zip`, `${dir}/INI.TXT`]);
    expect(decodeIso88598(entries[`${dir}/INI.TXT`]!)).toBe(result.iniText);
    const inner = unzipSync(entries[`${dir}/BKMVDATA.zip`]!);
    expect(decodeIso88598(inner['BKMVDATA.TXT']!)).toBe(result.bkmvdata);
    expect(result.summary.path).toBe('C:\\OPENFRMT\\12345678.26\\12151030');
  });

  it('sums the 2.6 report to the C100 count', async () => {
    const result = await buildUnifiedFile(testEnv(), '2027-01-01', '2027-01-31', { now: NOW });
    const sum = result.summary.documentTypes.reduce((s, t) => s + t.count, 0);
    expect(sum).toBe(result.report.recordCounts.C100);
    expect(result.summary.documentTypes.map((t) => t.code)).toContain(406);
  });

  it('writes one B110 customer account per client, keyed by the id in C100 field 1225', async () => {
    const client = await makeClient('Zeta', { nameHe: 'זטא', vat: '514713288' });
    await issue('400', '2027-02-05', { clientId: client, totalMinor: 50000, payments: [{ amountMinor: 50000, method: 'bank_transfer' }] });
    await issue('400', '2027-02-05', { clientId: client, totalMinor: 20000, payments: [{ amountMinor: 20000, method: 'cash' }] });

    const result = await buildUnifiedFile(testEnv(), '2027-02-05', '2027-02-05', { now: NOW });
    const b110 = lines(result.bkmvdata).filter((l) => l.startsWith('B110'));
    expect(b110).toHaveLength(1);
    expect(b110[0]).toHaveLength(376);
    expect(b110[0]!.slice(22, 37).trim()).toBe(String(client));
    expect(b110[0]!.slice(37, 87).trim()).toBe('זטא');
    expect(b110[0]!.slice(307, 322)).toBe('+00000000070000');
    const c100 = lines(result.bkmvdata).find((l) => l.startsWith('C100'))!;
    expect(c100.slice(374, 389).trim()).toBe(String(client));
  });

  it('writes the bank, branch and account of a cheque', async () => {
    const client = await makeClient('Eta');
    const id = await makeDraft({ seriesId: '400', totalMinor: 40000, payments: [{ amountMinor: 40000, method: 'cheque' }] });
    await run(db(), 'UPDATE documents SET client_id = ?, date = ? WHERE id = ?', client, '2027-02-10', id);
    await run(
      db(),
      "INSERT INTO payment_details (payment_id, cheque_crossed, bank_number, branch_number, account_number) SELECT id, 1, '12', '345', '678901' FROM payments WHERE document_id = ?",
      id,
    );
    await finalizeDocument(db(), id, { actor: OWNER_ACTOR });

    const result = await buildUnifiedFile(testEnv(), '2027-02-10', '2027-02-10', { now: NOW });
    const d120 = lines(result.bkmvdata).find((l) => l.startsWith('D120'))!;
    expect(d120[49]).toBe('2');
    expect(d120.slice(50, 60)).toBe('0000000012');
    expect(d120.slice(60, 70)).toBe('0000000345');
    expect(d120.slice(70, 85)).toBe('000000000678901');
    expect(result.report.warnings.some((w) => w.includes('cheque'))).toBe(false);
  });

  it('leaves out a customer VAT number with a wrong check digit, and says so', async () => {
    const client = await makeClient('Theta', { vat: '515667788' });
    await issue('400', '2027-02-15', { clientId: client, totalMinor: 10000, payments: [{ amountMinor: 10000, method: 'cash' }] });

    const result = await buildUnifiedFile(testEnv(), '2027-02-15', '2027-02-15', { now: NOW });
    const c100 = lines(result.bkmvdata).find((l) => l.startsWith('C100'))!;
    expect(c100.slice(252, 261)).toBe('000000000');
    expect(result.report.warnings.some((w) => w.includes('515667788'))).toBe(true);
  });

  it('checks Israeli ID check digits and prefixes secondary series', () => {
    expect(validIsraeliId('514713288')).toBe(true);
    expect(validIsraeliId('515667788')).toBe(false);
    expect(validIsraeliId('000000000')).toBe(false);
    expect(fileDocNumber('400', 400, 7)).toBe('7');
    expect(fileDocNumber('400-M', 400, 7)).toBe('M7');
    expect(fileDocNumber('405', 400, 7)).toBe('CR7');
    expect(fileDocNumber('PF', 300, 3)).toBe('PF3');
  });

  it('warns while the software has no registration number', async () => {
    const result = await buildUnifiedFile(testEnv({ SOFTWARE_REGISTRATION_NUMBER: '' }), '2027-01-01', '2027-01-01', { now: NOW });
    expect(result.report.warnings.some((w) => w.includes('registration number'))).toBe(true);
  });
});
