import { describe, expect, it } from 'vitest';
import awsInvoice from '../../fixtures/expenses/aws-invoice.json';
import officeSupplies from '../../fixtures/expenses/office-supplies.json';
import { ExtractedExpenseSchema } from '../../../src/modules/expenses/types';
import { FakeExtractor } from '../../../src/modules/expenses/fakes';
import type { ExpenseRow, SupplierRow } from '../../../src/modules/expenses/types';
import { buildApp, bytesFrom, call, uploadForm } from './helpers';

describe('expenses: extraction mapping from fixture JSON', () => {
  it('maps a foreign-currency invoice with no VAT line to minor units', async () => {
    const app = buildApp({ extractor: new FakeExtractor({ 'aws.pdf': ExtractedExpenseSchema.parse(awsInvoice) }) });
    const res = await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('aws'), 'aws.pdf', 'application/pdf') });
    expect(res.status).toBe(201);
    const expense = ((await res.json()) as { expense: ExpenseRow }).expense;

    expect(expense.currency).toBe('USD');
    expect(expense.amount_minor).toBe(4250);
    expect(expense.vat_amount_minor).toBe(0);
    expect(expense.document_number).toBe('AWS-2026-0091');
    expect(expense.document_date).toBe('2026-10-03');
    expect(expense.document_type).toBe('Invoice');

    const suppliers = (await (await call(app, '/suppliers')).json()) as { suppliers: SupplierRow[] };
    const supplier = suppliers.suppliers.find((s) => s.tax_id === 'US-AWS-001');
    expect(supplier?.name).toBe('Amazon Web Services');
  });

  it('maps an ILS tax invoice with a VAT line to minor units', async () => {
    const app = buildApp({ extractor: new FakeExtractor({ 'office.pdf': ExtractedExpenseSchema.parse(officeSupplies) }) });
    const res = await call(app, '/upload', { method: 'POST', body: uploadForm(bytesFrom('office'), 'office.pdf', 'application/pdf') });
    const expense = ((await res.json()) as { expense: ExpenseRow }).expense;

    expect(expense.currency).toBe('ILS');
    expect(expense.amount_minor).toBe(23600);
    expect(expense.vat_amount_minor).toBe(3600);
    expect(expense.document_number).toBe('OD-778812');
    // ILS needs no FX conversion: the ILS figure is the amount itself, with no rate attached.
    expect(expense.amount_ils_minor).toBe(23600);
    expect(expense.fx_rate).toBeNull();
  });

  it('rejects extraction output that does not match the schema', () => {
    expect(() => ExtractedExpenseSchema.parse({ ...awsInvoice, amount: '-42.50' })).toThrow();
    expect(() => ExtractedExpenseSchema.parse({ ...awsInvoice, amount: 'forty two' })).toThrow();
    expect(() => ExtractedExpenseSchema.parse({ ...awsInvoice, currency: 'XXX' })).toThrow();
  });

  it('accepts a lowercase currency code from the model and normalizes it', () => {
    const parsed = ExtractedExpenseSchema.parse({ ...awsInvoice, currency: 'usd' });
    expect(parsed.currency).toBe('USD');
  });
});
