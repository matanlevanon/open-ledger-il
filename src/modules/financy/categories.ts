/**
 * R40: Financy's categories as seen in live data, with readable English labels for the report and
 * MCP. The web app has the same list in English and Hebrew (web/src/features/financy/categories.ts).
 */
export const CATEGORY_LABELS: Record<string, string> = {
  TRANSFER: 'Transfers',
  BIT_PAYBOX: 'Bit and PayBox',
  INCOMES_EXPENSES: 'Income and expenses',
  NATIONAL_INSURANCE: 'National Insurance',
  DEPOSIT: 'Deposits',
  INSURANCE: 'Insurance',
  LOAN_TRANSACTION: 'Loans',
  FINANCE: 'Finance',
  'HEALTH_&_BEAUTY': 'Health and beauty',
  'HOUSEHOLD_&_SERVICES': 'Household and services',
  LEISURE: 'Leisure',
  OTHER: 'Other',
  SHOPPING: 'Shopping',
  TRANSPORT: 'Transport',
};

/** A known label, else the code made readable: "SOME_NEW_CODE" becomes "Some new code". */
export function categoryLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const known = CATEGORY_LABELS[code];
  if (known) return known;
  const words = code.replace(/_?&_?/g, ' and ').replace(/_/g, ' ').trim().toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : code;
}
