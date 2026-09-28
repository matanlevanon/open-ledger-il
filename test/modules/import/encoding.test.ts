import { describe, expect, it } from 'vitest';
import { decodeCsvText } from '../../../src/modules/import/encoding';

describe('CSV encoding', () => {
  it('reads a Windows-1255 export (Hebrew) as Hebrew', () => {
    // "לקוח,1" in Windows-1255
    const bytes = new Uint8Array([0xec, 0xf7, 0xe5, 0xe7, 0x2c, 0x31]);
    expect(decodeCsvText(bytes.buffer)).toBe('לקוח,1');
  });

  it('reads UTF-8 as UTF-8, with or without a BOM', () => {
    const utf8 = new TextEncoder().encode('לקוח,1');
    expect(decodeCsvText(utf8.buffer as ArrayBuffer)).toBe('לקוח,1');
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]);
    expect(decodeCsvText(withBom.buffer).replace(/^\uFEFF/, '')).toBe('לקוח,1');
  });
});
