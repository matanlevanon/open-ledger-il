import type { MessageKey } from '../../i18n';
import type { PeriodPreset } from './period';

/**
 * R21 reports list, grouped like SUMIT's "דוחות מערכת". `catalog` reports render through the
 * shared view over /api/reports/r/:id. The others keep their own panels.
 */

export type ReportGroup = 'clients' | 'income' | 'expenses' | 'tax';

export interface ReportEntry {
  id: string;
  label: MessageKey;
  group: ReportGroup | null;
  catalog: boolean;
  /** Default period preset. Null: the report reads open items as of today, with no period. */
  period: PeriodPreset | null;
  /** Offer compare-to-previous-period. The ILS column it compares. */
  compare?: string;
}

export const REPORT_GROUPS: { id: ReportGroup; label: MessageKey }[] = [
  { id: 'clients', label: 'rep.group.clients' },
  { id: 'income', label: 'rep.group.income' },
  { id: 'expenses', label: 'rep.group.expenses' },
  { id: 'tax', label: 'rep.group.tax' },
];

export const REPORT_ENTRIES: ReportEntry[] = [
  { id: 'client-statement', label: 'rep.clientStatement', group: 'clients', catalog: false, period: 'thisYear' },
  { id: 'debtors', label: 'rep.debtors', group: 'clients', catalog: true, period: null },
  { id: 'income-by-client', label: 'rep.incomeByClient', group: 'clients', catalog: true, period: 'thisYear', compare: 'totalIls' },

  { id: 'income', label: 'rep.income', group: 'income', catalog: false, period: 'thisYear' },
  { id: 'all-documents', label: 'rep.allDocuments', group: 'income', catalog: true, period: 'thisYear' },
  { id: 'sales-by-service', label: 'rep.salesByService', group: 'income', catalog: true, period: 'thisYear', compare: 'ils' },
  { id: 'income-by-payment-method', label: 'rep.incomeByPaymentMethod', group: 'income', catalog: true, period: 'thisYear', compare: 'ils' },
  { id: 'open-proformas', label: 'rep.openProformas', group: 'income', catalog: true, period: null },
  { id: 'open-payment-requests', label: 'rep.openPaymentRequests', group: 'income', catalog: true, period: null },
  { id: 'aged-receivables', label: 'rep.agedReceivables', group: 'income', catalog: true, period: null },
  { id: 'credits-issued', label: 'rep.creditsIssued', group: 'income', catalog: true, period: 'thisYear' },

  { id: 'expenses', label: 'rep.expenses', group: 'expenses', catalog: false, period: 'thisYear' },
  { id: 'purchases-by-supplier', label: 'rep.purchasesBySupplier', group: 'expenses', catalog: true, period: 'thisYear', compare: 'ils' },
  { id: 'expenses-by-category', label: 'rep.expensesByCategory', group: 'expenses', catalog: true, period: 'thisYear', compare: 'ils' },
  { id: 'fixed-vs-one-off', label: 'rep.fixedVsOneOff', group: 'expenses', catalog: true, period: 'thisYear' },

  { id: 'profit-loss', label: 'rep.profitLoss', group: 'tax', catalog: false, period: 'thisYear' },
  { id: 'cash-flow', label: 'rep.cashFlow', group: 'tax', catalog: true, period: 'last12' },
  { id: 'annual-summary', label: 'rep.annualSummary', group: 'tax', catalog: true, period: 'lastYear' },
  { id: 'ceiling', label: 'rep.ceiling', group: 'tax', catalog: false, period: null },
  { id: 'pack', label: 'rep.pack', group: 'tax', catalog: false, period: null },
  { id: 'documents-zip', label: 'rep.documentsZip', group: 'tax', catalog: false, period: 'lastMonth' },

  // Drill-down target only, not in the list.
  { id: 'expense-items', label: 'rep.expenseItems', group: null, catalog: true, period: 'thisYear' },
];

export const DEFAULT_REPORT = 'income';

export function reportEntry(id: string | null): ReportEntry {
  return REPORT_ENTRIES.find((r) => r.id === id) ?? REPORT_ENTRIES.find((r) => r.id === DEFAULT_REPORT)!;
}

/** URL filters a report may carry from a drill-down. */
export const FILTER_KEYS = ['clientId', 'clientName', 'type', 'status', 'bucket', 'supplierId', 'categoryId', 'fixed', 'service', 'method'];
