import { describe, expect, it } from 'vitest';
import {
  A000_FIELDS,
  A100_FIELDS,
  B110_FIELDS,
  C100_FIELDS,
  D110_FIELDS,
  D120_FIELDS,
  RECORD_LENGTH,
  SUMMARY_FIELDS,
  Z900_FIELDS,
  layoutLength,
  renderRecord,
} from '../../src/modules/exports/unified-file/records';

describe('unified file record layouts (instructions 1.31, sections 2.5, 3 and 4)', () => {
  it('each layout adds up to the record length in section 2.5', () => {
    expect(layoutLength(A000_FIELDS)).toBe(466);
    expect(layoutLength(SUMMARY_FIELDS)).toBe(19);
    expect(layoutLength(A100_FIELDS)).toBe(95);
    expect(layoutLength(B110_FIELDS)).toBe(376);
    expect(layoutLength(C100_FIELDS)).toBe(444);
    expect(layoutLength(D110_FIELDS)).toBe(339);
    expect(layoutLength(D120_FIELDS)).toBe(222);
    expect(layoutLength(Z900_FIELDS)).toBe(110);
  });

  it('writes amounts as a sign and zero-padded digits with no decimal point (section 2.3 ו)', () => {
    const line = renderRecord(C100_FIELDS, { 1200: 'C100', 1219: -1234565, 1223: 124565 }, RECORD_LENGTH.C100);
    // 1219 sits in columns 288-302, 1223 in 348-362 (1-based).
    expect(line.slice(287, 302)).toBe('-00000001234565');
    expect(line.slice(347, 362)).toBe('+00000000124565');
  });

  it('pads numbers with leading zeros and text with trailing spaces, and cuts long text', () => {
    const line = renderRecord(C100_FIELDS, { 1200: 'C100', 1201: 7, 1203: 400, 1204: '12', 1207: 'x'.repeat(60) }, RECORD_LENGTH.C100);
    expect(line.slice(0, 4)).toBe('C100');
    expect(line.slice(4, 13)).toBe('000000007');
    expect(line.slice(22, 25)).toBe('400');
    expect(line.slice(25, 45)).toBe('12'.padEnd(20, ' '));
    expect(line.slice(57, 107)).toBe('x'.repeat(50));
  });

  it('puts the D120 payment method in column 50 and the amount in 104-118', () => {
    const line = renderRecord(D120_FIELDS, { 1300: 'D120', 1306: 4, 1312: 50000 }, RECORD_LENGTH.D120);
    expect(line[49]).toBe('4');
    expect(line.slice(103, 118)).toBe('+00000000050000');
  });

  it('refuses a number that does not fit its field', () => {
    expect(() => renderRecord(A100_FIELDS, { 1100: 'A100', 1101: 1_000_000_000 }, RECORD_LENGTH.A100)).toThrow();
  });
});
