import { beforeAll, describe, expect, it } from 'vitest';
import { run } from '../../../src/core/db';
import { FakeExtractor } from '../../../src/modules/expenses/fakes';
import type { ExpenseRow, ExtractedExpense } from '../../../src/modules/expenses/types';
import { ACCOUNTANT_ENV, buildApp, bytesFrom, call, env, json, uploadForm } from './helpers';

const FIXTURE: ExtractedExpense = {
  supplierName: 'Zoom',
  supplierId: 'US-ZOOM-1',
  documentNumber: 'ZM-1',
  date: '2026-10-01',
  currency: 'USD',
  amount: '15.00',
  vatAmount: null,
  documentType: 'Invoice',
};

async function uploadOne(app: ReturnType<typeof buildApp>, filename = 'zoom.pdf') {
  const res = await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom(filename), filename, 'application/pdf') });
  return ((await res.json()) as { expense: ExpenseRow }).expense;
}

describe('expenses: status transitions', () => {
  it('refuses returning an expense without a reason', async () => {
    const app = buildApp({ extractor: new FakeExtractor({ 'zoom.pdf': FIXTURE }) });
    const expense = await uploadOne(app);
    const res = await call(app, `/${expense.id}/status`, json({ status: 'returned' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('validation_error');
  });

  it('accepts a returned status with a reason, and records who reviewed it', async () => {
    const app = buildApp({ extractor: new FakeExtractor({ 'zoom.pdf': FIXTURE }) });
    const expense = await uploadOne(app);
    const res = await call(app, `/${expense.id}/status`, json({ status: 'returned', reason: 'Blurry photo, please rescan' }));
    expect(res.status).toBe(200);
    const updated = ((await res.json()) as { expense: ExpenseRow }).expense;
    expect(updated.status).toBe('returned');
    expect(updated.status_reason).toBe('Blurry photo, please rescan');
    expect(updated.reviewed_at).toBeTruthy();
  });

  it('clears the reason when a returned expense moves on to filed', async () => {
    const app = buildApp({ extractor: new FakeExtractor({ 'zoom.pdf': FIXTURE }) });
    const expense = await uploadOne(app);
    await call(app, `/${expense.id}/status`, json({ status: 'returned', reason: 'Missing VAT line' }));
    const res = await call(app, `/${expense.id}/status`, json({ status: 'filed' }));
    const updated = ((await res.json()) as { expense: ExpenseRow }).expense;
    expect(updated.status).toBe('filed');
    expect(updated.status_reason).toBeNull();
  });

  it('walks every status value', async () => {
    const app = buildApp({ extractor: new FakeExtractor({ 'zoom.pdf': FIXTURE }) });
    const expense = await uploadOne(app);
    for (const status of ['filed', 'not_expense', 'duplicate']) {
      const res = await call(app, `/${expense.id}/status`, json({ status }));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { expense: ExpenseRow }).expense.status).toBe(status);
    }
  });

  it('404s on an unknown expense', async () => {
    const app = buildApp();
    const res = await call(app, '/999999/status', json({ status: 'filed' }));
    expect(res.status).toBe(404);
  });
});

describe('expenses: accountant permissions (runs/R09-accountant.md)', () => {
  beforeAll(async () => {
    const acc = await run(env.DB, `INSERT INTO users (email, role) VALUES ('cpa@example.com', 'accountant')`);
    await run(env.DB, `INSERT INTO user_features (user_id, feature, enabled) VALUES (?, 'expenses', 1)`, acc.lastRowId);
  });

  it('lets the accountant change status and category, but not the full record', async () => {
    const app = buildApp({ extractor: new FakeExtractor({ 'zoom.pdf': FIXTURE }) });
    const expense = await uploadOne(app);

    const status = await call(app, `/${expense.id}/status`, json({ status: 'filed' }), ACCOUNTANT_ENV);
    expect(status.status).toBe(200);

    const review = await call(app, `/${expense.id}/review`, json({ notes: 'Confirmed with supplier' }, { method: 'PATCH' }), ACCOUNTANT_ENV);
    expect(review.status).toBe(200);

    const fullEdit = await call(app, `/${expense.id}`, json({ amount: '99.00' }, { method: 'PATCH' }), ACCOUNTANT_ENV);
    expect(fullEdit.status).toBe(403);

    const supplierCreate = await call(app, '/suppliers', json({ name: 'New Co' }), ACCOUNTANT_ENV);
    expect(supplierCreate.status).toBe(403);
  });

  it('lets the owner do everything', async () => {
    const app = buildApp({ extractor: new FakeExtractor({ 'zoom.pdf': FIXTURE }) });
    const expense = await uploadOne(app);
    const fullEdit = await call(app, `/${expense.id}`, json({ notes: 'owner edit' }, { method: 'PATCH' }));
    expect(fullEdit.status).toBe(200);
  });
});
