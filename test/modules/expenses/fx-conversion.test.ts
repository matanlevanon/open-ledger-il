import { describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { convertToIls, convertWithRate } from '../../../src/modules/expenses/fx';
import { FakeExtractor } from '../../../src/modules/expenses/fakes';
import { FakeFxHistory, FxRates } from '../../../src/modules/fx';
import type { ExpenseRow, ExtractedExpense } from '../../../src/modules/expenses/types';
import { buildApp, bytesFrom, call, env, json, uploadForm } from './helpers';

describe('expenses: FX conversion to ILS', () => {
  it('converts at the given rate, rounding half away from zero', async () => {
    const fx = new FxRates(env.DB, new FakeFxHistory({ USD: { '2026-10-03': '3.75' } }));
    const result = await convertToIls(fx, 'USD', '2026-10-03', 4250);
    expect(result.amountIlsMinor).toBe(15938); // 42.50 * 3.75 = 159.375 -> 159.38
    expect(result.fxRate).toBe('3.750000');
    expect(result.fxSource).toBe('boi');
  });

  it('needs no rate for ILS: the ILS amount is the amount itself', async () => {
    const fx = new FxRates(env.DB, new FakeFxHistory({}));
    const result = await convertToIls(fx, 'ILS', '2026-10-03', 23600);
    expect(result).toEqual({ amountIlsMinor: 23600, fxRate: null, fxRateDate: null, fxSource: null });
  });

  it('leaves the ILS amount unset when no rate has ever been published for that currency', async () => {
    const fx = new FxRates(env.DB, new FakeFxHistory({}));
    const result = await convertToIls(fx, 'GBP', '2026-10-03', 4250);
    expect(result).toEqual({ amountIlsMinor: null, fxRate: null, fxRateDate: null, fxSource: null });
  });

  it('supports a manual override rate', () => {
    const result = convertWithRate(4250, '3.8');
    expect(result.amountIlsMinor).toBe(16150);
    expect(result.fxRate).toBe('3.800000');
    expect(result.fxSource).toBe('manual');
  });

  describe('one rate source: R04 rateOn (docs/currency-and-fx.md: last published rate on or before the date)', () => {
    it('picks the latest rate on or before the date, never a later one', async () => {
      await run(env.DB, `INSERT INTO fx_rates (currency, rate_date, rate) VALUES ('EUR', '2026-10-01', '3.70')`);
      await run(env.DB, `INSERT INTO fx_rates (currency, rate_date, rate) VALUES ('EUR', '2026-10-03', '3.75')`);
      await run(env.DB, `INSERT INTO fx_rates (currency, rate_date, rate) VALUES ('EUR', '2026-10-10', '3.90')`);
      const fx = new FxRates(env.DB);

      // Weekend with no rate of its own: falls back to the last published rate before it.
      expect((await convertToIls(fx, 'EUR', '2026-10-04', 100)).fxRate).toBe('3.750000');
      expect((await convertToIls(fx, 'EUR', '2026-10-04', 100)).fxRateDate).toBe('2026-10-03');
      expect((await convertToIls(fx, 'EUR', '2026-10-03', 100)).fxRate).toBe('3.750000');
      expect((await convertToIls(fx, 'EUR', '2026-09-30', 100)).amountIlsMinor).toBeNull();
    });

    it('backfills a past date from the Bank of Israel series when the cache has no rate for it', async () => {
      const history = new FakeFxHistory({ USD: { '2025-03-02': '3.610000', '2025-03-03': '3.620000' } });
      const fx = new FxRates(env.DB, history);
      const result = await convertToIls(fx, 'USD', '2025-03-03', 10000);
      expect(result).toEqual({ amountIlsMinor: 36200, fxRate: '3.620000', fxRateDate: '2025-03-03', fxSource: 'boi' });
      expect(history.calls).toHaveLength(1);
    });
  });

  describe('end to end through an ingested expense', () => {
    const FIXTURE: ExtractedExpense = {
      supplierName: 'Amazon Web Services',
      supplierId: 'US-AWS-001',
      documentNumber: 'AWS-1',
      date: '2026-10-03',
      currency: 'USD',
      amount: '42.50',
      vatAmount: null,
      documentType: 'Invoice',
    };

    it('freezes the rate on the expense at creation', async () => {
      const fx = new FxRates(env.DB, new FakeFxHistory({ USD: { '2026-10-03': '3.75' } }));
      const app = buildApp({ fx, extractor: new FakeExtractor({ 'aws.pdf': FIXTURE }) });
      const res = await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('aws'), 'aws.pdf', 'application/pdf') });
      const expense = ((await res.json()) as { expense: ExpenseRow }).expense;
      expect(expense.amount_ils_minor).toBe(15938);
      expect(expense.fx_rate).toBe('3.750000');
    });

    it('lets the owner override the rate on the review screen', async () => {
      const fx = new FxRates(env.DB, new FakeFxHistory({ USD: { '2026-10-03': '3.75' } }));
      const app = buildApp({ fx, extractor: new FakeExtractor({ 'aws.pdf': FIXTURE }) });
      const created = await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('aws'), 'aws.pdf', 'application/pdf') });
      const expense = ((await created.json()) as { expense: ExpenseRow }).expense;

      const patched = await call(app, `/${expense.id}`, json({ fxRateOverride: '3.80' }, { method: 'PATCH' }));
      const updated = ((await patched.json()) as { expense: ExpenseRow }).expense;
      expect(updated.fx_rate).toBe('3.800000');
      expect(updated.fx_source).toBe('manual');
      expect(updated.amount_ils_minor).toBe(16150);
    });
  });
});
