import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../../src/modules/import/csv';
import { guessCustomerMapping, guessInvoiceMapping } from '../../../src/modules/import/mapping';
import { WAVE_CUSTOMERS_CSV, WAVE_INVOICES_CSV } from '../../fixtures/import/wave';

describe('import: field mapping guesses', () => {
  it('maps the Wave customers header row', () => {
    const { headers } = parseCsv(WAVE_CUSTOMERS_CSV);
    const mapping = guessCustomerMapping(headers);
    expect(mapping).toMatchObject({
      nameEn: 'Customer Name',
      email: 'Email',
      phone: 'Phone',
      currency: 'Currency',
      country: 'Country',
      companyId: 'Business Number',
    });
    expect(mapping.notes).toBeNull();
  });

  it('maps the Wave invoices header row', () => {
    const { headers } = parseCsv(WAVE_INVOICES_CSV);
    const mapping = guessInvoiceMapping(headers);
    expect(mapping).toMatchObject({
      externalId: 'Invoice Number',
      clientName: 'Customer',
      docDate: 'Invoice Date',
      currency: 'Currency',
      amount: 'Amount',
      status: 'Status',
    });
  });

  it('leaves a field unmapped when no header matches', () => {
    const mapping = guessCustomerMapping(['Full Name']);
    expect(mapping.nameEn).toBeNull();
  });
});
