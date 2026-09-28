import { describe, expect, it } from 'vitest';
import { blank, padAlpha, padDate, padNumeric, padSignedMinor, renderLine } from '../../src/modules/exports/fixed-width';

describe('fixed-width field padding (runs/R13-exports.md tests: "Fixed-width field padding")', () => {
  it('left-aligns and space-pads text', () => {
    expect(padAlpha('ABC', 6)).toBe('ABC   ');
    expect(padAlpha('', 3)).toBe('   ');
  });

  it('rejects text longer than the field', () => {
    expect(() => padAlpha('TOOLONG', 3)).toThrow();
  });

  it('right-aligns and zero-pads a non-negative integer', () => {
    expect(padNumeric(42, 5)).toBe('00042');
    expect(padNumeric(0, 3)).toBe('000');
  });

  it('rejects a negative number or one that overflows the field', () => {
    expect(() => padNumeric(-1, 5)).toThrow();
    expect(() => padNumeric(123456, 3)).toThrow();
  });

  it('renders a signed minor amount with a trailing sign character', () => {
    expect(padSignedMinor(12345, 8)).toBe('00012345+');
    expect(padSignedMinor(-500, 8)).toBe('00000500-');
  });

  it('converts an ISO date to the 8-digit YYYYMMDD form', () => {
    expect(padDate('2026-10-05')).toBe('20261005');
  });

  it('rejects a date that is not YYYY-MM-DD', () => {
    expect(() => padDate('10/05/2026')).toThrow();
  });

  it('fills a reserved field with spaces', () => {
    expect(blank(4)).toBe('    ');
  });

  it('renderLine concatenates fields and checks each is exactly its declared width', () => {
    const line = renderLine([
      { value: 'A000', width: 4 },
      { value: padNumeric(7, 3), width: 3 },
    ]);
    expect(line).toBe('A000007');
  });

  it('renderLine catches a field that does not match its declared width', () => {
    expect(() => renderLine([{ value: 'AB', width: 3 }])).toThrow();
  });
});
