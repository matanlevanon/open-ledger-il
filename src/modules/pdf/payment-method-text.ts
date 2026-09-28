import type { Lang } from './labels';
import type { RenderPaymentMethod } from './types';

/**
 * A payment method's printable details (R17 task 2's catalog, R17 task 6's "Payment transfer
 * method" section and the receipt's payment method table): bank transfer's structured fields in
 * the SUMIT reference's own order (beneficiary, bank, branch, account, then IBAN/SWIFT/address
 * only when set), or a plain "<name>: <identifier>" for every other type.
 */
export function paymentMethodDetailText(method: RenderPaymentMethod, lang: Lang): string {
  if (method.type !== 'bank_transfer') {
    const identifier = method.details.identifier;
    return identifier ? `${method.displayName}: ${identifier}` : method.displayName;
  }
  const d = method.details;
  const parts: string[] = [];
  if (lang === 'he') {
    if (d.accountHolder) parts.push(`מוטב: ${d.accountHolder}`);
    if (d.bankNumber || d.bankName) parts.push(`בנק: ${[d.bankNumber, d.bankName ? `(${d.bankName})` : null].filter(Boolean).join(' ')}`);
    if (d.branch) parts.push(`סניף: ${d.branch}`);
    if (d.accountNumber) parts.push(`חשבון: ${d.accountNumber}`);
    if (d.iban) parts.push(`IBAN: ${d.iban}`);
    if (d.swiftBic) parts.push(`SWIFT/BIC: ${d.swiftBic}`);
    if (d.bankAddress) parts.push(`כתובת הבנק: ${d.bankAddress}`);
  } else {
    if (d.accountHolder) parts.push(`Beneficiary: ${d.accountHolder}`);
    if (d.bankNumber || d.bankName) parts.push(`Bank: ${[d.bankNumber, d.bankName ? `(${d.bankName})` : null].filter(Boolean).join(' ')}`);
    if (d.branch) parts.push(`Branch: ${d.branch}`);
    if (d.accountNumber) parts.push(`Account: ${d.accountNumber}`);
    if (d.iban) parts.push(`IBAN: ${d.iban}`);
    if (d.swiftBic) parts.push(`SWIFT/BIC: ${d.swiftBic}`);
    if (d.bankAddress) parts.push(`Bank address: ${d.bankAddress}`);
  }
  return parts.length > 0 ? parts.join(', ') : method.displayName;
}
