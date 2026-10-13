import { beforeEach, describe, expect, it } from 'vitest';
import { api, clock, line, makeClient, ok } from './helpers';

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

describe('default payment methods per client (R28 task 11)', () => {
  async function method(name: string): Promise<number> {
    const res = await ok('POST', '/payment-methods', { displayName: name, type: 'other' });
    return res.paymentMethods.find((m: any) => m.display_name === name).id as number;
  }
  const draftFor = async (type: string, clientId: number, extra: Record<string, unknown> = {}) =>
    (await ok('POST', '/documents', { type, clientId, lines: [line(10000)], ...extra })).document;
  const idsOf = (doc: any) => (doc.payment_method_ids ? JSON.parse(doc.payment_method_ids) : []);

  it('a client has no default payment methods until set, and the list round-trips', async () => {
    const a = await method('Default A');
    const b = await method('Default B');
    const created = await ok('POST', '/clients', { nameEn: 'Defaults Ltd' });
    expect(created.client.default_payment_method_ids).toBeNull();
    const updated = await ok('PATCH', `/clients/${created.client.id}`, { defaultPaymentMethodIds: [b, a] });
    expect(JSON.parse(updated.client.default_payment_method_ids)).toEqual([b, a]);
    expect(JSON.parse((await ok('PATCH', `/clients/${created.client.id}`, { notes: 'x' })).client.default_payment_method_ids)).toEqual([b, a]);
    expect((await ok('PATCH', `/clients/${created.client.id}`, { defaultPaymentMethodIds: [] })).client.default_payment_method_ids).toBeNull();
    expect((await api('PATCH', `/clients/${created.client.id}`, { defaultPaymentMethodIds: [999999] })).status).toBe(409);
  });

  // The tax invoice (305) is off for the test business, an osek patur. The rule does not look at the type.
  it('a new payment request, pro forma and receipt start with exactly the client defaults', async () => {
    await method('Start A');
    const b = await method('Start B');
    const clientId = await makeClient({ defaultPaymentMethodIds: [b] });
    for (const type of ['PR', '300', '400']) {
      const doc = await draftFor(type, clientId, type === '400' ? { lines: [], payments: [] } : {});
      expect(idsOf(doc)).toEqual([b]);
    }
  });

  it('the owner can still change them per document', async () => {
    const a = await method('Change A');
    const b = await method('Change B');
    const clientId = await makeClient({ defaultPaymentMethodIds: [a] });
    const doc = await draftFor('PR', clientId, { paymentMethodIds: [b] });
    expect(idsOf(doc)).toEqual([b]);
  });

  it('an inactive method is skipped, and an empty list keeps the last-used rule', async () => {
    const a = await method('Skip A');
    const b = await method('Skip B');
    const clientId = await makeClient({ defaultPaymentMethodIds: [a, b] });
    await ok('POST', `/payment-methods/${a}/deactivate`);
    expect(idsOf(await draftFor('PR', clientId))).toEqual([b]);

    const plain = await makeClient();
    const used = await draftFor('PR', plain, { paymentMethodIds: [b] });
    await ok('POST', `/documents/${used.id}/finalize`, {});
    expect(idsOf(await draftFor('PR', plain))).toEqual([b]);
  });
});
