import type { FxRate } from '../../../src/modules/fx/provider';

/** Fixture BOI rates for a Friday publication, used across fx tests. Tests never call BOI. */
export const FRIDAY = '2026-10-02';
export const SATURDAY = '2026-10-03';
export const SUNDAY = '2026-10-04';
export const MONDAY = '2026-10-05';

export const FIXTURE_RATES: Record<'USD' | 'EUR' | 'GBP', FxRate> = {
  USD: { rate: '3.712000', rateDate: FRIDAY, source: 'boi' },
  EUR: { rate: '4.021500', rateDate: FRIDAY, source: 'boi' },
  GBP: { rate: '4.705300', rateDate: FRIDAY, source: 'boi' },
};
