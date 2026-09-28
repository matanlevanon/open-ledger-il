import { beforeAll, describe, expect, it } from 'vitest';
import { ceilingFor, configOn, legalModeOn, thresholdOn, vatRateOn } from '../../src/core/config';
import { run } from '../../src/core/db';
import { ConfigError } from '../../src/core/errors';
import { db } from '../helpers';

describe('config: legal values come from effective-dated rows', () => {
  it('reads the seeded values', async () => {
    expect((await legalModeOn(db(), '2026-10-01')).mode).toBe('patur');
    expect((await vatRateOn(db(), '2026-10-01')).rate_bp).toBe(1800);
    expect((await thresholdOn(db(), 'allocation', '2026-10-01'))?.amount_minor).toBe(500000);
    expect((await ceilingFor(db(), '2026-10-01'))?.amount_minor).toBe(12283300);
  });

  it('applies nothing before the first effective date', async () => {
    await expect(vatRateOn(db(), '2024-12-31')).rejects.toBeInstanceOf(ConfigError);
    await expect(legalModeOn(db(), '2019-12-31')).rejects.toBeInstanceOf(ConfigError);
    expect(await thresholdOn(db(), 'allocation', '2026-05-31')).toBeNull();
    expect(await ceilingFor(db(), '2027-03-01')).toBeNull();
  });

  it('refuses malformed dates', async () => {
    await expect(vatRateOn(db(), '2026-13-01')).rejects.toThrow(RangeError);
    await expect(vatRateOn(db(), '2026-02-30')).rejects.toThrow(RangeError);
  });

  describe('with later rows', () => {
    beforeAll(async () => {
      await run(db(), `INSERT INTO legal_modes (mode, effective_from) VALUES ('murshe', '2030-07-15')`);
      await run(db(), `INSERT INTO vat_rates (rate_bp, effective_from) VALUES (1900, '2030-01-01')`);
      await run(db(), `INSERT INTO thresholds (key, amount_minor, effective_from) VALUES ('allocation', 250000, '2030-01-01')`);
      await run(db(), `INSERT INTO ceilings (year, amount_minor) VALUES (2030, 13000000)`);
    });

    it('switches on the effective date, not before', async () => {
      expect((await legalModeOn(db(), '2030-07-14')).mode).toBe('patur');
      expect((await legalModeOn(db(), '2030-07-15')).mode).toBe('murshe');
      expect((await vatRateOn(db(), '2029-12-31')).rate_bp).toBe(1800);
      expect((await vatRateOn(db(), '2030-01-01')).rate_bp).toBe(1900);
    });

    it('builds a snapshot for one date', async () => {
      const early = await configOn(db(), '2026-10-01');
      expect(early.legalMode.mode).toBe('patur');
      expect(early.thresholds.allocation?.amount_minor).toBe(500000);
      const late = await configOn(db(), '2030-08-01');
      expect(late.legalMode.mode).toBe('murshe');
      expect(late.vatRate.rate_bp).toBe(1900);
      expect(late.thresholds.allocation?.amount_minor).toBe(250000);
      expect(late.ceiling?.amount_minor).toBe(13000000);
    });
  });
});
