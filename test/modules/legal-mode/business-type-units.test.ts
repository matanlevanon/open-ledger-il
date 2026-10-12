import { describe, expect, it } from 'vitest';
import { showsCeiling, vatPeriodOn } from '../../../src/modules/legal-mode/business-type';

describe('vatPeriodOn (R24 dashboard VAT card)', () => {
  it('bi-monthly periods start in odd months and report on the due day of the next month', () => {
    expect(vatPeriodOn('2026-10-12', 'bimonthly', 15)).toEqual({ from: '2026-09-01', to: '2026-10-31', reportDue: '2026-11-15' });
    expect(vatPeriodOn('2026-09-01', 'bimonthly', 15)).toEqual({ from: '2026-09-01', to: '2026-10-31', reportDue: '2026-11-15' });
    expect(vatPeriodOn('2028-02-10', 'bimonthly', 15)).toEqual({ from: '2028-01-01', to: '2028-02-29', reportDue: '2028-03-15' });
  });

  it('November to December reports in January of the next year', () => {
    expect(vatPeriodOn('2026-12-31', 'bimonthly', 15)).toEqual({ from: '2026-11-01', to: '2026-12-31', reportDue: '2027-01-15' });
    expect(vatPeriodOn('2026-12-05', 'monthly', 19)).toEqual({ from: '2026-12-01', to: '2026-12-31', reportDue: '2027-01-19' });
  });

  it('monthly periods are one calendar month', () => {
    expect(vatPeriodOn('2026-04-30', 'monthly', 15)).toEqual({ from: '2026-04-01', to: '2026-04-30', reportDue: '2026-05-15' });
  });
});

describe('showsCeiling (R24 dashboard ceiling card)', () => {
  it('פטור always, a company never', () => {
    expect(showsCeiling('osek_patur', null, '2026-10-12')).toBe(true);
    expect(showsCeiling('company', { effective_from: '2026-10-12', note: 'already registered' }, '2026-10-12')).toBe(false);
  });

  it('מורשה only in the calendar year it switched from פטור', () => {
    const switched = { effective_from: '2026-06-01', note: null };
    expect(showsCeiling('osek_murshe', switched, '2026-12-31')).toBe(true);
    expect(showsCeiling('osek_murshe', switched, '2027-01-01')).toBe(false);
    expect(showsCeiling('osek_murshe', { effective_from: '2026-06-01', note: 'already registered' }, '2026-07-01')).toBe(false);
  });
});
