import type { ModuleDef } from '../../core/module';
import { ACCOUNTANT_PACK_CRON, reportsScheduled } from './cron';
import { reportsRoutes } from './routes';

export function createReportsModule(options: { today?: () => string } = {}): ModuleDef {
  return {
    name: 'reports',
    basePath: '/reports',
    routes: reportsRoutes(options),
    crons: [ACCOUNTANT_PACK_CRON],
    scheduled: reportsScheduled,
  };
}

export const reportsModule = createReportsModule();

export { incomeReport, incomeDetail, summarizeIncome, type IncomeReport, type IncomeDetailRow } from './income';
export { expenseReport, expenseDetail, summarizeExpenses, expenseFilesForPeriod, type ExpenseReport, type ExpenseDetailRow } from './expenses';
export { profitLossReport, type ProfitLossReport } from './profit-loss';
export { advanceBaseReport, type AdvanceBaseReport } from './advance-base';
export { clientLedgersReport, type ClientLedgersReport, type ClientLedgerReportRow } from './client-ledgers';
export { buildAccountantPack, monthRange, previousPeriod, type AccountantPackResult } from './pack';
export { ACCOUNTANT_PACK_CRON, reportsScheduled } from './cron';
export { toCsv } from './csv';
export { buildXlsx, type XlsxSheet } from './xlsx';
