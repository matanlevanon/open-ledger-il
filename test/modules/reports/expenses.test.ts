import { describe, expect, it } from 'vitest';
import { first, run } from '../../../src/core/db';
import { expenseFilesForPeriod, expenseReport } from '../../../src/modules/reports';
import { db } from '../../helpers';

async function makeSupplier(name: string): Promise<number> {
  const { lastRowId } = await run(db(), 'INSERT INTO suppliers (name) VALUES (?)', name);
  return lastRowId;
}

async function makeExpense(input: {
  supplierId?: number | null;
  categoryKey?: string;
  status?: string;
  documentDate: string;
  amountMinor: number;
  amountIlsMinor?: number | null;
  currency?: string;
  fileId?: number | null;
}): Promise<number> {
  const category = input.categoryKey
    ? await first<{ id: number }>(db(), 'SELECT id FROM expense_categories WHERE key = ?', input.categoryKey)
    : null;
  const { lastRowId } = await run(
    db(),
    `INSERT INTO expenses (supplier_id, category_id, status, document_date, currency, amount_minor, amount_ils_minor, file_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    input.supplierId ?? null,
    category?.id ?? null,
    input.status ?? 'filed',
    input.documentDate,
    input.currency ?? 'ILS',
    input.amountMinor,
    input.amountIlsMinor === undefined ? input.amountMinor : input.amountIlsMinor,
    input.fileId ?? null,
  );
  return lastRowId;
}

describe('expenseReport: expenses by month, category and supplier (runs/R08-reports.md)', () => {
  it('counts filed and new expenses, grouped by month, category and supplier', async () => {
    const supplier = await makeSupplier('Cloud Co');
    await makeExpense({ supplierId: supplier, categoryKey: 'software', documentDate: '2026-11-05', amountMinor: 12000 });
    await makeExpense({ supplierId: supplier, categoryKey: 'software', documentDate: '2026-11-20', amountMinor: 8000, status: 'new' });

    const report = await expenseReport(db(), '2026-11-01', '2026-11-30');
    expect(report.rows).toHaveLength(2);
    expect(report.totalIlsMinor).toBe(20000);
    expect(report.byMonth).toEqual([{ month: '2026-11', totalIlsMinor: 20000 }]);
    expect(report.byCategory.find((c) => c.categoryName === 'Software')?.totalIlsMinor).toBe(20000);
    expect(report.bySupplier.find((s) => s.supplierName === 'Cloud Co')?.totalIlsMinor).toBe(20000);
  });

  it('excludes not_expense, duplicate and returned statuses', async () => {
    await makeExpense({ documentDate: '2026-11-06', amountMinor: 5000, status: 'not_expense' });
    await makeExpense({ documentDate: '2026-11-06', amountMinor: 6000, status: 'duplicate' });
    await makeExpense({ documentDate: '2026-11-06', amountMinor: 7000, status: 'returned' });

    const report = await expenseReport(db(), '2026-11-06', '2026-11-06');
    expect(report.rows).toHaveLength(0);
  });

  it('lists the files of counted expenses in the period for the accountant pack ZIP', async () => {
    const { lastRowId: fileId } = await run(
      db(),
      `INSERT INTO expense_files (source, r2_key, filename, content_type, size_bytes, sha256) VALUES ('upload', ?, ?, 'application/pdf', 10, ?)`,
      'expenses/abc.pdf',
      'invoice.pdf',
      'abc',
    );
    await makeExpense({ documentDate: '2026-12-01', amountMinor: 4000, fileId });

    const files = await expenseFilesForPeriod(db(), '2026-12-01', '2026-12-31');
    expect(files).toEqual([{ r2Key: 'expenses/abc.pdf', filename: 'invoice.pdf' }]);
  });
});
