import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { toCsv } from '../../../src/modules/reports/csv';
import { decimalMinor, numberMinor } from '../../../src/modules/reports/format';
import { buildXlsx } from '../../../src/modules/reports/xlsx';

describe('reports/format: decimalMinor and numberMinor', () => {
  it('formats agorot as a plain decimal, no thousands grouping', () => {
    expect(decimalMinor(123456)).toBe('1234.56');
    expect(decimalMinor(-123456)).toBe('-1234.56');
    expect(decimalMinor(5)).toBe('0.05');
    expect(numberMinor(123456)).toBe(1234.56);
  });
});

describe('reports/csv: toCsv', () => {
  it('quotes a field only when it needs it', () => {
    const csv = toCsv(['A', 'B'], [
      ['plain', 'has, a comma'],
      ['has "quotes"', 'line\nbreak'],
    ]);
    expect(csv).toBe('A,B\r\nplain,"has, a comma"\r\n"has ""quotes""","line\nbreak"\r\n');
  });
});

describe('reports/xlsx: buildXlsx', () => {
  it('produces a zip with the required OOXML parts and the given sheet names', () => {
    const bytes = buildXlsx([
      { name: 'Income', rows: [['Date', 'Amount'], ['2026-10-01', 123.45]] },
      { name: 'Expenses', rows: [['Date', 'Amount'], ['2026-10-02', -5]] },
    ]);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);

    const workbook = strFromU8(files['xl/workbook.xml']!);
    expect(workbook).toContain('name="Income"');
    expect(workbook).toContain('name="Expenses"');

    const sheet1 = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(sheet1).toContain('<t xml:space="preserve">Date</t>');
    expect(sheet1).toContain('<v>123.45</v>');
  });

  it('escapes XML special characters in a text cell', () => {
    const bytes = buildXlsx([{ name: 'Sheet', rows: [['Tom & Jerry <ltd> "co"']] }]);
    const sheet1 = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']!);
    expect(sheet1).toContain('Tom &amp; Jerry &lt;ltd&gt; &quot;co&quot;');
  });

  it('refuses to build a workbook with no sheets', () => {
    expect(() => buildXlsx([])).toThrow(RangeError);
  });
});
