import { describe, expect, it } from 'vitest';
import { buildA000, buildA100, buildB110, buildC100, buildD110, buildZ900 } from '../../src/modules/exports/unified-file/records';

const HEADER = { businessVatNumber: '777777715', businessNameEn: 'Sample Business Ltd', fileCreatedOn: '2026-11-01', periodFrom: '2026-10-01', periodTo: '2026-10-31' };

describe('unified-file record builders (stub layout, runs/R13-exports.md)', () => {
  it('A000 and A100 start with their record code and carry the business VAT number', () => {
    expect(buildA000(HEADER).startsWith('A000777777715')).toBe(true);
    expect(buildA100(HEADER).startsWith('A100777777715')).toBe(true);
  });

  it('C100 leaves the allocation column blank when no allocation number is given', () => {
    const line = buildC100({
      seq: 1,
      specDocType: '400',
      documentNumber: 12,
      date: '2026-10-05',
      clientVatNumber: '514713288',
      subtotalIlsMinor: 100000,
      vatIlsMinor: 0,
      totalIlsMinor: 100000,
      allocationShortNumber: null,
    });
    expect(line.endsWith(' '.repeat(9))).toBe(true);
  });

  it('C100 carries a zero-padded 9-digit allocation number when one is given', () => {
    const line = buildC100({
      seq: 1,
      specDocType: '305',
      documentNumber: 12,
      date: '2026-10-05',
      clientVatNumber: '514713288',
      subtotalIlsMinor: 100000,
      vatIlsMinor: 18000,
      totalIlsMinor: 118000,
      allocationShortNumber: '123456',
    });
    expect(line.endsWith('000123456')).toBe(true);
  });

  it('D110 carries the line description and its sequence numbers', () => {
    const line = buildD110({ seq: 1, documentSeq: 1, position: 1, description: 'Consulting', lineTotalIlsMinor: 100000 });
    expect(line.startsWith('D110')).toBe(true);
    expect(line).toContain('Consulting');
  });

  it('B110 leaves the allocation column blank without one and fills it with one', () => {
    const withoutAllocation = buildB110({ seq: 1, supplierVatNumber: '514713288', date: '2026-10-05', amountIlsMinor: 50000, vatIlsMinor: 9000, allocationShortNumber: null });
    const withAllocation = buildB110({ seq: 1, supplierVatNumber: '514713288', date: '2026-10-05', amountIlsMinor: 50000, vatIlsMinor: 9000, allocationShortNumber: '999999999' });
    expect(withoutAllocation.endsWith(' '.repeat(9))).toBe(true);
    expect(withAllocation.endsWith('999999999')).toBe(true);
  });

  it('Z900 carries the total record count', () => {
    expect(buildZ900(42)).toBe('Z900000000042');
  });
});
