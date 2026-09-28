import { describe, expect, it } from 'vitest';
import { parseCsv, toRecords } from '../../../src/modules/import/csv';
import { WAVE_CUSTOMERS_CSV, WAVE_INVOICES_CSV } from '../../fixtures/import/wave';

describe('import: CSV parsing', () => {
  it('splits headers and rows, trimming a BOM', () => {
    const csv = parseCsv('﻿Name,Email\r\nAlice,alice@example.com\r\n');
    expect(csv.headers).toEqual(['Name', 'Email']);
    expect(csv.rows).toEqual([['Alice', 'alice@example.com']]);
  });

  it('keeps commas and newlines inside quoted fields, and unescapes doubled quotes', () => {
    const csv = parseCsv('Name,Note\r\n"Smith, John","Said ""hi"" then\nleft"\r\n');
    expect(csv.rows).toEqual([['Smith, John', 'Said "hi" then\nleft']]);
  });

  it('parses the Wave customers fixture into records keyed by header', () => {
    const csv = parseCsv(WAVE_CUSTOMERS_CSV);
    const records = toRecords(csv);
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ 'Customer Name': 'Example Client Ltd', Currency: 'EUR' });
    expect(records[1]!['Customer Name']).toBe('Northwind Traders, Inc.');
  });

  it('parses the Wave invoices fixture, keeping the quoted comma-and-amount fields intact', () => {
    const csv = parseCsv(WAVE_INVOICES_CSV);
    const records = toRecords(csv);
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({ Customer: 'Northwind Traders, Inc.', Amount: '1,250.00' });
  });

  it('ignores a trailing blank line', () => {
    const csv = parseCsv('A,B\n1,2\n\n');
    expect(csv.rows).toEqual([['1', '2']]);
  });
});
