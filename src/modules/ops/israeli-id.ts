/**
 * Israeli ID (ת"ז) and company number (ח.פ) check digit: nine digits, weights 1,2,1,2,..., a
 * product above 9 adds its two digits, and the sum divides by 10. Shorter numbers pad with
 * leading zeros, as the Population Registry does.
 */
export function isValidIsraeliId(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d{5,9}$/.test(digits)) return false;
  const padded = digits.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const product = Number(padded[i]) * (i % 2 === 0 ? 1 : 2);
    sum += product > 9 ? product - 9 : product;
  }
  return sum % 10 === 0;
}
