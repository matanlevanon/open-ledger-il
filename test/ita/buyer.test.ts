import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { supplierCheckRequired, supplierConfirmationNumber, supplierInvoiceDetails } from '../../src/modules/ita/buyer';
import { ITA_PATHS } from '../../src/modules/ita/config';
import { OWN_VAT, setupIta } from './helpers';

const SUPPLIER = '514713288';
const INVOICE = {
  vat_number: SUPPLIER,
  customer_vat_number: OWN_VAT,
  invoice_reference_number: '4471',
  invoice_date: '2027-02-10',
  payment_amount: 8200,
  vat_amount: 1476,
  confirmation_number: '20270210101010123000444555',
};

describe('buyer side: supplier invoices above the threshold', () => {
  it('the check is required only above the allocation threshold in force on the invoice date', async () => {
    expect(await supplierCheckRequired(env.DB, 500000, '2027-02-10')).toBe(false);
    expect(await supplierCheckRequired(env.DB, 500001, '2027-02-10')).toBe(true);
    // Before the first threshold row there is nothing to check.
    expect(await supplierCheckRequired(env.DB, 9_000_000, '2026-01-01')).toBe(false);
  });

  it('details by the short 9-digit number, with our VAT number as the customer', async () => {
    const { env: ienv, deps, mock } = await setupIta();
    mock.supplierInvoices.push(INVOICE);
    const result = await supplierInvoiceDetails(ienv, deps, { supplier_vat_number: SUPPLIER, confirmation_number: '000444555' });
    expect(result).toMatchObject({ found: true, data: { invoice_reference_number: '4471', payment_amount: 8200, vat_amount: 1476 } });
    expect(mock.apiCalls(ITA_PATHS.details)[0]!.body).toEqual({
      customer_vat_number: 777777715,
      confirmation_number: '000444555',
      vat_number: 514713288,
    });
  });

  it('details: 472 when nothing matches', async () => {
    const { env: ienv, deps } = await setupIta();
    expect(await supplierInvoiceDetails(ienv, deps, { supplier_vat_number: SUPPLIER, confirmation_number: '999999999' })).toMatchObject({
      found: false,
      code: '472',
    });
  });

  it('confirmationNumber finds the number from the invoice details', async () => {
    const { env: ienv, deps, mock } = await setupIta();
    mock.supplierInvoices.push(INVOICE);
    const input = { supplier_vat_number: SUPPLIER, payment_amount_minor: 820000, vat_amount_minor: 147600, invoice_date: '2027-02-10', invoice_reference_number: '4471' };
    expect(await supplierConfirmationNumber(ienv, deps, input)).toEqual({
      found: true,
      data: { confirmation_number: INVOICE.confirmation_number, short_number: '000444555' },
    });
    expect(await supplierConfirmationNumber(ienv, deps, { ...input, vat_amount_minor: 147500 })).toMatchObject({ found: false, code: '472' });
  });

  it('validates the supplier VAT number', async () => {
    const { env: ienv, deps } = await setupIta();
    await expect(supplierInvoiceDetails(ienv, deps, { supplier_vat_number: '123', confirmation_number: '123456789' })).rejects.toMatchObject({
      code: 'validation_error',
    });
  });

  it('ITA down raises ita_unavailable', async () => {
    const { env: ienv, deps, mock } = await setupIta();
    mock.forceNext(500);
    await expect(supplierInvoiceDetails(ienv, deps, { supplier_vat_number: SUPPLIER, confirmation_number: '123456789' })).rejects.toMatchObject({
      code: 'ita_unavailable',
    });
  });
});
