/**
 * R40: Financy's categories as seen in live data, with readable labels. The server keeps the
 * English list for the report and MCP (src/modules/financy/categories.ts).
 */
const LABELS: Record<string, { en: string; he: string }> = {
  TRANSFER: { en: 'Transfers', he: 'העברות' },
  BIT_PAYBOX: { en: 'Bit and PayBox', he: 'ביט ופייבוקס' },
  INCOMES_EXPENSES: { en: 'Income and expenses', he: 'הכנסות והוצאות' },
  NATIONAL_INSURANCE: { en: 'National Insurance', he: 'ביטוח לאומי' },
  DEPOSIT: { en: 'Deposits', he: 'הפקדות' },
  INSURANCE: { en: 'Insurance', he: 'ביטוח' },
  LOAN_TRANSACTION: { en: 'Loans', he: 'הלוואות' },
  FINANCE: { en: 'Finance', he: 'פיננסים' },
  'HEALTH_&_BEAUTY': { en: 'Health and beauty', he: 'בריאות ויופי' },
  'HOUSEHOLD_&_SERVICES': { en: 'Household and services', he: 'משק בית ושירותים' },
  LEISURE: { en: 'Leisure', he: 'פנאי' },
  OTHER: { en: 'Other', he: 'אחר' },
  SHOPPING: { en: 'Shopping', he: 'קניות' },
  TRANSPORT: { en: 'Transport', he: 'תחבורה' },
};

/** A known label in the reader's language, else the code made readable. */
export function categoryLabel(code: string | null | undefined, locale: 'en' | 'he'): string | null {
  if (!code) return null;
  const known = LABELS[code];
  if (known) return known[locale];
  const words = code.replace(/_?&_?/g, ' and ').replace(/_/g, ' ').trim().toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : code;
}

/** "Shopping" or "Transfers / Bit and PayBox". */
export function categoryText(main: string | null, sub: string | null, locale: 'en' | 'he'): string | null {
  return [categoryLabel(main, locale), categoryLabel(sub, locale)].filter(Boolean).join(' / ') || null;
}
