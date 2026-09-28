import { describe, expect, it } from 'vitest';
import { isValidAbaRouting } from '../../src/modules/payment-methods/schemas';
import { paymentMethodDetailText } from '../../src/modules/pdf/payment-method-text';

describe('US ACH payment method text', () => {
  const method = {
    displayName: 'US ACH',
    type: 'bank_transfer' as const,
    details: {
      bankCountry: 'US',
      bankName: 'Example Bank',
      routingNumber: '021000021',
      accountNumber: '000123456789',
      accountType: 'checking',
      accountHolder: 'Sample Business',
      bankNumber: null,
      branch: null,
      iban: null,
      swiftBic: null,
      bankAddress: null,
    },
  };

  it('prints the routing number and account type in place of bank number and branch', () => {
    expect(paymentMethodDetailText(method, 'en')).toBe(
      'Beneficiary: Sample Business, Bank: Example Bank, Routing (ABA): 021000021, Account: 000123456789, Account type: Checking',
    );
    expect(paymentMethodDetailText(method, 'he')).toContain('Routing (ABA): 021000021');
    expect(paymentMethodDetailText(method, 'he')).toContain('סוג חשבון: Checking');
  });

  it('checks the ABA check digit', () => {
    expect(isValidAbaRouting('021000021')).toBe(true);
    expect(isValidAbaRouting('021000022')).toBe(false);
    expect(isValidAbaRouting('12345678')).toBe(false);
  });
});
