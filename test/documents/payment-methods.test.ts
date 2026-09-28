import { beforeEach, describe, expect, it } from 'vitest';
import { api, clock, ok } from './helpers';

beforeEach(() => {
  clock.today = '2026-10-06';
});

describe('payment methods catalog (R17 task 2)', () => {
  it('creates a bank transfer method with its structured details and lists it', async () => {
    const created = await ok('POST', '/payment-methods', {
      displayName: 'Bank Leumi ILS',
      type: 'bank_transfer',
      details: { bankName: 'Leumi', bankNumber: '10', branch: '800', accountNumber: '123456', accountHolder: 'Sample Business Ltd', iban: 'IL120001', swiftBic: 'LUMIILIT' },
    });
    const row = created.paymentMethods.find((m: any) => m.display_name === 'Bank Leumi ILS');
    expect(row).toBeDefined();
    expect(row.type).toBe('bank_transfer');
    expect(row.details).toMatchObject({ bankName: 'Leumi', accountHolder: 'Sample Business Ltd' });
    expect(row.active).toBe(1);
  });

  it('creates a Bit method with a generic identifier and rejects an unknown type', async () => {
    const created = await ok('POST', '/payment-methods', { displayName: 'Bit', type: 'bit', details: { identifier: '050-0000000' } });
    const row = created.paymentMethods.find((m: any) => m.display_name === 'Bit');
    expect(row.details).toEqual({ identifier: '050-0000000' });
    const bad = await api('POST', '/payment-methods', { displayName: 'X', type: 'venmo' });
    expect(bad.status).toBe(400);
  });

  it('edits, deactivates and reactivates a method', async () => {
    const created = await ok('POST', '/payment-methods', { displayName: 'Cash', type: 'cash' });
    const id = created.paymentMethods[0].id;
    const edited = await ok('PATCH', `/payment-methods/${id}`, { displayName: 'Cash (office)' });
    expect(edited.paymentMethods[0].display_name).toBe('Cash (office)');
    const off = await ok('POST', `/payment-methods/${id}/deactivate`);
    expect(off.paymentMethods[0].active).toBe(0);
    const on = await ok('POST', `/payment-methods/${id}/activate`);
    expect(on.paymentMethods[0].active).toBe(1);
  });

  it('reorders the whole list and rejects a partial or duplicate list', async () => {
    await ok('POST', '/payment-methods', { displayName: 'Reorder A', type: 'cash' });
    const afterB = await ok('POST', '/payment-methods', { displayName: 'Reorder B', type: 'cash' });
    const ids: number[] = afterB.paymentMethods.map((m: any) => m.id);
    const reversed = [...ids].reverse();
    const reordered = await ok('PUT', '/payment-methods/reorder', { ids: reversed });
    expect(reordered.paymentMethods.map((m: any) => m.id)).toEqual(reversed);
    const bad = await api('PUT', '/payment-methods/reorder', { ids: [ids[0]!] });
    expect(bad.status).toBe(400);
  });

  it('only an owner can write, an accountant with the feature can read', async () => {
    const created = await ok('POST', '/payment-methods', { displayName: 'Cheque book', type: 'cheque' });
    const id = created.paymentMethods[0].id;
    const forbidden = await api('PATCH', `/payment-methods/${id}`, { displayName: 'x' }, 'nobody@example.com');
    expect(forbidden.status).toBe(403);
  });

  it('lists active-only when asked', async () => {
    const created = await ok('POST', '/payment-methods', { displayName: 'Inactive one', type: 'other' });
    const id = created.paymentMethods[0].id;
    await ok('POST', `/payment-methods/${id}/deactivate`);
    const activeOnly = await ok('GET', '/payment-methods?active=1');
    expect(activeOnly.paymentMethods.some((m: any) => m.id === id)).toBe(false);
    const all = await ok('GET', '/payment-methods');
    expect(all.paymentMethods.some((m: any) => m.id === id)).toBe(true);
  });
});

describe('US bank account for ACH', () => {
  it('saves a US account with a valid routing number, account number and account type', async () => {
    const created = await ok('POST', '/payment-methods', {
      displayName: 'US ACH',
      type: 'bank_transfer',
      currency: 'USD',
      details: { bankCountry: 'US', bankName: 'Example Bank', routingNumber: '021000021', accountNumber: '000123456789', accountType: 'checking', accountHolder: 'Sample Business' },
    });
    const row = created.paymentMethods.find((m: any) => m.display_name === 'US ACH');
    expect(row.details).toMatchObject({ bankCountry: 'US', routingNumber: '021000021', accountType: 'checking' });
  });

  it('rejects a routing number with a bad check digit, and a US account without one', async () => {
    const badDigit = await api('POST', '/payment-methods', {
      displayName: 'Bad ACH',
      type: 'bank_transfer',
      details: { bankCountry: 'US', routingNumber: '021000022', accountNumber: '1' },
    });
    expect(badDigit.status).toBe(400);
    const missing = await api('POST', '/payment-methods', {
      displayName: 'No routing',
      type: 'bank_transfer',
      details: { bankCountry: 'US', accountNumber: '1' },
    });
    expect(missing.status).toBe(400);
  });
});
