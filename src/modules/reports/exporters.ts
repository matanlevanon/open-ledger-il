import { decimalMinor, numberMinor } from './format';
import type { IncomeReport } from './income';
import type { ExpenseReport } from './expenses';
import type { ProfitLossReport } from './profit-loss';
import type { AdvanceBaseReport } from './advance-base';
import type { ClientLedgersReport } from './client-ledgers';
import { toCsv } from './csv';
import { type XlsxSheet, buildXlsx } from './xlsx';

const INCOME_HEADERS = ['Date', 'Type', 'Number', 'Client', 'Currency', 'Amount', 'Amount ILS'];
const EXPENSE_HEADERS = ['Date', 'Supplier', 'Category', 'Currency', 'Amount', 'Amount ILS'];
const PROFIT_LOSS_HEADERS = ['Month', 'Income ILS', 'Expenses ILS', 'Net ILS'];
const ADVANCE_BASE_HEADERS = ['Month', 'Total ILS'];

function incomeRows(report: IncomeReport, cell: (minor: number, currency: string) => string | number) {
  return report.rows.map((r) => [
    r.date,
    r.typeNameEn,
    r.displayNumber ?? '',
    r.clientName ?? '',
    r.currency,
    cell(r.amountMinor, r.currency),
    r.amountIlsMinor === null ? '' : cell(r.amountIlsMinor, 'ILS'),
  ]);
}

function expenseRows(report: ExpenseReport, cell: (minor: number, currency: string) => string | number) {
  return report.rows.map((r) => [
    r.date ?? '',
    r.supplierName ?? '',
    r.categoryName ?? '',
    r.currency,
    cell(r.amountMinor, r.currency),
    r.amountIlsMinor === null ? '' : cell(r.amountIlsMinor, 'ILS'),
  ]);
}

function profitLossRows(report: ProfitLossReport, cell: (minor: number) => string | number) {
  return report.months.map((m) => [m.month, cell(m.incomeIlsMinor), cell(m.expensesIlsMinor), cell(m.netIlsMinor)]);
}

function advanceBaseRows(report: AdvanceBaseReport, cell: (minor: number) => string | number) {
  return report.months.map((m) => [m.month, cell(m.totalIlsMinor)]);
}

const CLIENT_LEDGER_HEADERS = ['Client', 'Date', 'Type', 'Number', 'Description', 'Currency', 'Debit', 'Credit', 'Balance', 'Balance ILS'];

function clientLedgerRows(report: ClientLedgersReport, cell: (minor: number, currency: string) => string | number) {
  const rows: (string | number)[][] = [];
  for (const c of report.clients) {
    for (const e of c.ledger.entries) {
      rows.push([
        c.clientName,
        e.date,
        e.type_name_en,
        e.display_number ?? '',
        e.description,
        e.currency,
        e.debit_minor === 0 ? '' : cell(e.debit_minor, e.currency),
        e.credit_minor === 0 ? '' : cell(e.credit_minor, e.currency),
        cell(e.balance_minor, e.currency),
        cell(e.balance_ils_minor, 'ILS'),
      ]);
    }
  }
  return rows;
}

export function incomeCsv(report: IncomeReport): string {
  return toCsv(INCOME_HEADERS, incomeRows(report, decimalMinor));
}
export function expenseCsv(report: ExpenseReport): string {
  return toCsv(EXPENSE_HEADERS, expenseRows(report, decimalMinor));
}
export function profitLossCsv(report: ProfitLossReport): string {
  return toCsv(PROFIT_LOSS_HEADERS, profitLossRows(report, (m) => decimalMinor(m)));
}
export function advanceBaseCsv(report: AdvanceBaseReport): string {
  return toCsv(ADVANCE_BASE_HEADERS, advanceBaseRows(report, (m) => decimalMinor(m)));
}
export function clientLedgersCsv(report: ClientLedgersReport): string {
  return toCsv(CLIENT_LEDGER_HEADERS, clientLedgerRows(report, decimalMinor));
}

export function incomeSheet(report: IncomeReport): XlsxSheet {
  return { name: 'Income', rows: [INCOME_HEADERS, ...incomeRows(report, numberMinor)] };
}
export function expenseSheet(report: ExpenseReport): XlsxSheet {
  return { name: 'Expenses', rows: [EXPENSE_HEADERS, ...expenseRows(report, numberMinor)] };
}
export function profitLossSheet(report: ProfitLossReport): XlsxSheet {
  return { name: 'Profit and loss', rows: [PROFIT_LOSS_HEADERS, ...profitLossRows(report, (m) => numberMinor(m))] };
}
export function advanceBaseSheet(report: AdvanceBaseReport): XlsxSheet {
  return { name: 'Advance payment base', rows: [ADVANCE_BASE_HEADERS, ...advanceBaseRows(report, (m) => numberMinor(m))] };
}
/** Client ledgers (תוספת ה׳), R16 task 11: every document and payment per client, running balance in both currencies. */
export function clientLedgersSheet(report: ClientLedgersReport): XlsxSheet {
  return { name: 'Client ledgers', rows: [CLIENT_LEDGER_HEADERS, ...clientLedgerRows(report, numberMinor)] };
}

export function incomeXlsx(report: IncomeReport): Uint8Array {
  return buildXlsx([incomeSheet(report)]);
}
export function expenseXlsx(report: ExpenseReport): Uint8Array {
  return buildXlsx([expenseSheet(report)]);
}
