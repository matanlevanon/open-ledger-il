/** Synthetic unified-file (מבנה אחיד) records (runs/_common.md: never real client data).
 * Field layout is not decoded (see src/modules/import/sumit.ts), so these lines only need a
 * realistic record-type prefix; the rest of each line is placeholder digits. */

export const INI_TEXT = 'ראש קובץ בדיקה 1.31 000000000';

export const BKMVDATA_LINES = [
  'C1000000000001TESTBUSINESS0000000000000123',
  'D1100000000010000000000010000000000010000',
  'D1200000000010000000000010000000000010000',
  'A1000000000010000000000000000000000000000', // not one of the three history record types
];

export const BKMVDATA_TEXT = BKMVDATA_LINES.join('\r\n');
