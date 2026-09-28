import { describe, expect, it } from 'vitest';
import { quarterLabel } from '../../../src/modules/ops/drive-backup';

describe('quarterLabel', () => {
  it('maps a date to its calendar quarter', () => {
    expect(quarterLabel('2026-01-15')).toBe('2026-Q1');
    expect(quarterLabel('2026-03-31')).toBe('2026-Q1');
    expect(quarterLabel('2026-04-01')).toBe('2026-Q2');
    expect(quarterLabel('2026-06-30')).toBe('2026-Q2');
    expect(quarterLabel('2026-07-01')).toBe('2026-Q3');
    expect(quarterLabel('2026-09-30')).toBe('2026-Q3');
    expect(quarterLabel('2026-10-01')).toBe('2026-Q4');
    expect(quarterLabel('2026-12-31')).toBe('2026-Q4');
  });

  it('reads the date from a full ISO timestamp', () => {
    expect(quarterLabel('2026-10-06T03:00:00.000Z')).toBe('2026-Q4');
  });
});
