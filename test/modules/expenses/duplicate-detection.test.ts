import { describe, expect, it } from 'vitest';
import { FakeExtractor } from '../../../src/modules/expenses/fakes';
import type { ExpenseRow, ExtractedExpense } from '../../../src/modules/expenses/types';
import { buildApp, bytesFrom, call, uploadForm } from './helpers';

// Storage is isolated per test FILE, not per test (docs/architecture.md), so every fixture
// below uses its own document number even where the rule under test does not need it.
const AWS: ExtractedExpense = {
  supplierName: 'Amazon Web Services',
  supplierId: 'US-AWS-001',
  documentNumber: 'UNUSED',
  date: '2026-10-03',
  currency: 'USD',
  amount: '42.50',
  vatAmount: null,
  documentType: 'Invoice',
};

describe('expenses: duplicate detection on file hash', () => {
  it('flags a second upload of the same bytes, even under a different name', async () => {
    const extractor = new FakeExtractor({
      'first.pdf': { ...AWS, documentNumber: 'HASH-91' },
      'second.pdf': { ...AWS, documentNumber: 'HASH-92' }, // different number: only the hash matches
    });
    const app = buildApp({ extractor });
    const bytes = bytesFrom('identical file content');

    const first = await call(app, '/upload', { method: 'POST', body: uploadForm(bytes, 'first.pdf', 'application/pdf') });
    expect(first.status).toBe(201);
    const firstExpense = ((await first.json()) as { expense: ExpenseRow }).expense;
    expect(firstExpense.status).toBe('new');

    const second = await call(app, '/upload', { method: 'POST', body: uploadForm(bytes, 'second.pdf', 'application/pdf') });
    const secondExpense = ((await second.json()) as { expense: ExpenseRow }).expense;
    expect(secondExpense.status).toBe('duplicate');
    expect(secondExpense.duplicate_of_id).toBe(firstExpense.id);
    expect(secondExpense.status_reason).toMatch(/same file/i);
  });

  it('does not flag two different files with different content', async () => {
    const extractor = new FakeExtractor({
      'a.pdf': { ...AWS, documentNumber: 'DIFF-1' },
      'b.pdf': { ...AWS, documentNumber: 'DIFF-2' },
    });
    const app = buildApp({ extractor });

    const a = await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('content a'), 'a.pdf', 'application/pdf') });
    const b = await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('content b'), 'b.pdf', 'application/pdf') });
    expect(((await a.json()) as { expense: ExpenseRow }).expense.status).toBe('new');
    expect(((await b.json()) as { expense: ExpenseRow }).expense.status).toBe('new');
  });
});

describe('expenses: duplicate detection on supplier plus document number', () => {
  it('flags a second, differently-scanned file with the same supplier and document number', async () => {
    const extractor = new FakeExtractor({
      'scan1.jpg': { ...AWS, documentNumber: 'SCAN-1' },
      'scan2.jpg': { ...AWS, documentNumber: 'SCAN-1' },
    });
    const app = buildApp({ extractor });

    const first = await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('scan one'), 'scan1.jpg', 'image/jpeg') });
    const firstExpense = ((await first.json()) as { expense: ExpenseRow }).expense;
    expect(firstExpense.status).toBe('new');

    const second = await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('scan two, different bytes'), 'scan2.jpg', 'image/jpeg') });
    const secondExpense = ((await second.json()) as { expense: ExpenseRow }).expense;
    expect(secondExpense.status).toBe('duplicate');
    expect(secondExpense.duplicate_of_id).toBe(firstExpense.id);
    expect(secondExpense.status_reason).toMatch(/supplier and document number/i);
  });

  it('does not flag the same supplier with a different document number', async () => {
    const extractor = new FakeExtractor({
      'jan.pdf': { ...AWS, documentNumber: 'MONTH-JAN' },
      'feb.pdf': { ...AWS, documentNumber: 'MONTH-FEB' },
    });
    const app = buildApp({ extractor });

    const jan = await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('january bill'), 'jan.pdf', 'application/pdf') });
    const feb = await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('february bill'), 'feb.pdf', 'application/pdf') });
    expect(((await jan.json()) as { expense: ExpenseRow }).expense.status).toBe('new');
    expect(((await feb.json()) as { expense: ExpenseRow }).expense.status).toBe('new');
  });

  it('reuses the same supplier row by tax id across uploads', async () => {
    const extractor = new FakeExtractor({
      'jan2.pdf': { ...AWS, documentNumber: 'REUSE-JAN' },
      'feb2.pdf': { ...AWS, documentNumber: 'REUSE-FEB' },
    });
    const app = buildApp({ extractor });
    await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('january bill v2'), 'jan2.pdf', 'application/pdf') });
    await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('february bill v2'), 'feb2.pdf', 'application/pdf') });

    const suppliers = (await (await call(app, '/suppliers')).json()) as { suppliers: { tax_id: string | null }[] };
    expect(suppliers.suppliers.filter((s) => s.tax_id === 'US-AWS-001')).toHaveLength(1);
  });
});
