import { describe, expect, it } from 'vitest';
import { assertLowercaseKeys } from '../../src/modules/ita/client';
import { itaIdentity } from '../../src/modules/ita/config';
import { decryptToken, encryptToken, importTokenKey } from '../../src/modules/ita/crypto';
import { customerVatFor } from '../../src/modules/ita/documents';
import { buildApprovalBody, buildDecisionBody, buildMultiApprovalBody, n122 } from '../../src/modules/ita/payload';
import { approvalFromBody, decisionOutcome, multiApprovalOutcome, shortAllocationNumber } from '../../src/modules/ita/responses';
import * as spec from '../fixtures/ita/spec-examples';
import { OWNER_ID, OWN_VAT, TEST_TOKEN_KEY, itaEnv, taxInvoice } from './helpers';

const identity = { vatNumber: OWN_VAT, userId: OWNER_ID, accountingSoftwareNumber: OWN_VAT };

describe('allocation rule: 9-digit short number', () => {
  it('takes the rightmost 9 digits of the spec example', () => {
    expect(shortAllocationNumber('20240627231846297178091822')).toBe('178091822');
    expect(shortAllocationNumber('20260429140042271119068285')).toBe('119068285');
  });

  it('keeps a 9-digit number as it is and trims spaces', () => {
    expect(shortAllocationNumber(' 123456789 ')).toBe('123456789');
  });

  it('refuses fewer than 9 digits or non-digits', () => {
    expect(() => shortAllocationNumber('12345678')).toThrow(RangeError);
    expect(() => shortAllocationNumber('2024-0627-2318')).toThrow(RangeError);
  });
});

describe('ITA rule 8: v2 field names are lowercase', () => {
  it('every key of an Approval, MultiApproval and decision body is lowercase', () => {
    const doc = taxInvoice(1);
    const approval = buildApprovalBody(doc, identity, { invoiceId: 'abc' });
    const multi = buildMultiApprovalBody([approval], identity, [doc]);
    const decision = buildDecisionBody('abc', identity);
    for (const body of [approval, multi, decision]) {
      expect(() => assertLowercaseKeys(body)).not.toThrow();
      expect(JSON.stringify(body)).not.toMatch(/"[^"]*[A-Z][^"]*":/);
    }
  });

  it('the client refuses a body with an uppercase key', () => {
    expect(() => assertLowercaseKeys({ invoice_id: '1', items: [{ Index: 1 }] })).toThrow(/body.items\[0\].Index/);
  });
});

describe('Approval body', () => {
  it('maps the document to table 2.1', () => {
    const body = buildApprovalBody(taxInvoice(7, { number: 1234, discountMinor: 1050, amountBeforeDiscountMinor: 601050 }), identity, {
      invoiceId: 'inv-7',
    });
    expect(body).toMatchObject({
      invoice_id: 'inv-7',
      invoice_type: 305,
      vat_number: 777777715,
      user_id: 123456782,
      invoice_reference_number: '1234',
      customer_vat_number: 514713288,
      customer_name: 'Acme Ltd',
      invoice_date: '2027-02-25',
      invoice_issuance_date: '2027-02-25',
      accounting_software_number: 777777715,
      amount_before_discount: 6010.5,
      discount: 10.5,
      payment_amount: 6000,
      vat_amount: 1080,
      payment_amount_including_vat: 7080,
    });
    expect(body).not.toHaveProperty('action');
    expect(body.items).toEqual([
      { index: 1, description: 'Strategy retainer', quantity: 1, price_per_unit: 6000, discount: 0, total_amount: 6000, vat_rate: 18 },
    ]);
  });

  it('writes N12.2 amounts from integer agorot without float math', () => {
    expect(n122(500001)).toBe(5000.01);
    expect(n122(7)).toBe(0.07);
    expect(n122(-1999)).toBe(-19.99);
    expect(JSON.stringify({ a: n122(123456789012) })).toBe('{"a":1234567890.12}');
    expect(() => n122(1.5)).toThrow(RangeError);
  });

  it('refuses a document without a number: the number comes before the ITA call', () => {
    expect(() => buildApprovalBody(taxInvoice(1, { number: null }), identity, { invoiceId: 'x' })).toThrow(/no number/);
  });

  it('MultiApproval summary adds up the list (table 2.6)', () => {
    const a = taxInvoice(1);
    const b = taxInvoice(2, { paymentAmountMinor: 500001, vatAmountMinor: 90000 });
    const body = buildMultiApprovalBody([{}, {}], identity, [a, b]);
    expect(body).toMatchObject({ invoices_amount: 2, invoices_payment_amount: 11000.01, invoices_vat_amount: 1980 });
  });

  it('a client without an Israeli VAT number goes as 999999998 (FAQ 55)', () => {
    expect(customerVatFor(null, null)).toBe('999999998');
    expect(customerVatFor('51-471328-8', null)).toBe('514713288');
    expect(customerVatFor(null, '12345678')).toBe('012345678');
  });
});

describe('spec response examples', () => {
  it('approved example gives the number and the short number', () => {
    expect(approvalFromBody(200, spec.APPROVAL_APPROVED)).toEqual({
      kind: 'approved',
      httpStatus: 200,
      confirmationNumber: '20240627231846297178091822',
      shortNumber: '178091822',
    });
  });

  it('460 and 461 ask for one of the four choices', () => {
    expect(approvalFromBody(200, spec.APPROVAL_460)).toMatchObject({ kind: 'refused', code: '460' });
    expect(approvalFromBody(200, spec.APPROVAL_461)).toMatchObject({ kind: 'refused', code: '461' });
  });

  it('462 needs no action', () => {
    expect(approvalFromBody(200, spec.APPROVAL_462)).toMatchObject({ kind: 'already_decided', code: '462' });
  });

  it('431 points at the client record, 434 and 435 at the date, 446 at the config', () => {
    expect(approvalFromBody(400, spec.APPROVAL_431)).toMatchObject({ kind: 'invalid', code: '431', fix: 'client_vat' });
    expect(approvalFromBody(400, spec.APPROVAL_434)).toMatchObject({ kind: 'invalid', code: '434', fix: 'date' });
    expect(approvalFromBody(400, spec.APPROVAL_435)).toMatchObject({ kind: 'invalid', code: '435', fix: 'date' });
    expect(approvalFromBody(400, spec.APPROVAL_446)).toMatchObject({ kind: 'invalid', code: '446', fix: 'config' });
  });

  it('a confirmation number of 0 is never a number', () => {
    expect(approvalFromBody(200, { status: 200, confirmation_number: 0, approved: true })).toMatchObject({ kind: 'invalid' });
  });

  it('chapter 5 HTTP errors without an error list map to a config fix', () => {
    for (const status of [403, 404, 406, 422]) {
      expect(approvalFromBody(status, { status, message: spec.HTTP_ERRORS[status] })).toMatchObject({
        kind: 'invalid',
        code: `http_${status}`,
        fix: 'config',
      });
    }
  });

  it('MultiApproval example 1: refusals, 462 with 446, and date errors per invoice', () => {
    const out = multiApprovalOutcome({ kind: 'response', status: 200, json: spec.MULTI_EXAMPLE_1 });
    expect(out.mainError).toBeNull();
    expect(out.byInvoiceId.get('8748489')).toMatchObject({ kind: 'refused', code: '460' });
    expect(out.byInvoiceId.get('14325366')).toMatchObject({ kind: 'already_decided', code: '462' });
    expect(out.byInvoiceId.get('68767687687')).toMatchObject({ kind: 'invalid', code: '435' });
    expect(out.byInvoiceId.get('68787687687')).toMatchObject({ kind: 'invalid', code: '434' });
  });

  it('MultiApproval example 2: successes carry their numbers', () => {
    const out = multiApprovalOutcome({ kind: 'response', status: 200, json: spec.MULTI_EXAMPLE_2 });
    expect(out.transactionId).toBe('20240710181229229191035598');
    expect(out.byInvoiceId.get('68768757858')).toMatchObject({ kind: 'approved', shortNumber: '191063077' });
    expect(out.byInvoiceId.get('6876876875')).toMatchObject({ kind: 'approved', shortNumber: '191084625' });
    expect(out.byInvoiceId.get('798798687')).toMatchObject({ kind: 'refused' });
  });

  it('MultiApproval 400 with wrong invoice data maps each invoice', () => {
    const out = multiApprovalOutcome({ kind: 'response', status: 400, json: spec.MULTI_400_INVOICES });
    expect(out.mainError).toBeNull();
    expect(out.byInvoiceId.get('14325366')).toMatchObject({ kind: 'invalid', code: '434' });
    expect(out.byInvoiceId.get('6875875858')).toMatchObject({ kind: 'invalid', code: '435' });
  });

  it('MultiApproval 438 in the summary fails the whole batch', () => {
    const out = multiApprovalOutcome({ kind: 'response', status: 400, json: spec.MULTI_400_MAIN });
    expect(out.mainError).toMatchObject({ kind: 'invalid', code: '438', fix: 'config' });
  });

  it('decision accepted and 463', () => {
    expect(decisionOutcome({ kind: 'response', status: 200, json: spec.DECISION_ACCEPTED })).toEqual({ kind: 'accepted' });
    expect(decisionOutcome({ kind: 'response', status: 400, json: spec.DECISION_463 })).toMatchObject({ kind: 'rejected', code: '463' });
  });
});

describe('secrets', () => {
  it('tokens encrypt with AES-GCM and do not decrypt in the other environment', async () => {
    const key = await importTokenKey(TEST_TOKEN_KEY);
    const stored = await encryptToken(key, 'rt-secret', 'sandbox:refresh');
    expect(stored).not.toContain('rt-secret');
    expect(await decryptToken(key, stored, 'sandbox:refresh')).toBe('rt-secret');
    await expect(decryptToken(key, stored, 'production:refresh')).rejects.toThrow();
  });

  it('a missing or short token key is a config error', () => {
    expect(() => importTokenKey(undefined)).toThrow(/ITA_TOKEN_KEY/);
    expect(() => importTokenKey(btoa('short'))).toThrow(/32 bytes/);
  });

  it('the ID number and VAT number come from secrets and must have 9 digits', () => {
    expect(itaIdentity(itaEnv())).toEqual(identity);
    expect(itaIdentity(itaEnv({ ITA_VAT_NUMBER: undefined })).vatNumber).toBe(OWNER_ID);
    expect(() => itaIdentity(itaEnv({ OWNER_TAX_ID: undefined }))).toThrow(/OWNER_TAX_ID/);
  });
});
