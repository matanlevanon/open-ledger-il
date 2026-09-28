import { describe, expect, it } from 'vitest';
import { buildPcn874Row } from '../../src/modules/exports/pcn874/build';

const BASE = {
  seq: 1,
  specDocType: '305',
  documentNumber: 42,
  date: '2026-10-05',
  customerVatNumber: '514713288',
  subtotalIlsMinor: 500000,
  vatIlsMinor: 90000,
};

describe('PCN874 row format (runs/R13-exports.md tests: "PCN874 row format, allocation number column")', () => {
  it('carries the 9-digit allocation number as its own, fixed-width column', () => {
    const line = buildPcn874Row({ ...BASE, allocationShortNumber: '123456789' });
    expect(line.endsWith('123456789')).toBe(true);
    expect(line.slice(-9)).toHaveLength(9);
  });

  it('zero-pads a short allocation number to 9 digits', () => {
    const line = buildPcn874Row({ ...BASE, allocationShortNumber: '42' });
    expect(line.endsWith('000000042')).toBe(true);
  });

  it('leaves the allocation column blank when there is no allocation number yet', () => {
    const line = buildPcn874Row({ ...BASE, allocationShortNumber: null });
    expect(line.endsWith(' '.repeat(9))).toBe(true);
  });

  it('starts with the record code and the printed document number', () => {
    const line = buildPcn874Row({ ...BASE, allocationShortNumber: null });
    expect(line.startsWith('R874')).toBe(true);
    expect(line).toContain('000000042');
  });
});
