import { describe, expect, it } from 'vitest';
import { decodeWindows1255, encodeWindows1255 } from '../../src/modules/exports/encoding';

describe('Windows-1255 encoding round trip (runs/R13-exports.md tests: "encoding round trip")', () => {
  it('round trips ASCII text', () => {
    const { bytes, lossy } = encodeWindows1255('Open Ledger IL 2026');
    expect(lossy).toBe(false);
    expect(decodeWindows1255(bytes)).toBe('Open Ledger IL 2026');
  });

  it('round trips Hebrew business names', () => {
    const text = 'חשבונית מס מספר 305 עבור שירותי תוכנה';
    const { bytes, lossy } = encodeWindows1255(text);
    expect(lossy).toBe(false);
    expect(decodeWindows1255(bytes)).toBe(text);
  });

  it('round trips the new shekel sign', () => {
    const { bytes, lossy } = encodeWindows1255('₪1,234.56');
    expect(lossy).toBe(false);
    expect(decodeWindows1255(bytes)).toBe('₪1,234.56');
  });

  it('encodes one byte per character (single-byte code page)', () => {
    const text = 'שלום world';
    expect(encodeWindows1255(text).bytes.length).toBe(text.length);
  });

  it('substitutes an unmappable character with "?" and reports lossy', () => {
    const { bytes, lossy } = encodeWindows1255('emoji \u{1F600}');
    expect(lossy).toBe(true);
    expect(decodeWindows1255(bytes)).toContain('?');
  });
});
