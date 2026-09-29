/**
 * Reports feature strings (R16 task 16): income, expenses, profit and loss, the עוסק פטור
 * ceiling meter, and the monthly accountant pack — everything under web/src/features/reports/.
 */
export const reports = {
  'unified.business': 'Business',
  'unified.title': 'Unified file',
  'unified.subtitle': 'Open format (מבנה אחיד), version 1.31, for the Tax Authority',
  'unified.dialogTitle': 'Create the files',
  'unified.drive': 'Drive',
  'unified.from': 'From date',
  'unified.to': 'To date',
  'unified.help': 'Covers documents dated in the range. The zip holds OPENFRMT with INI.TXT and BKMVDATA. Extract it to the root of the drive you chose.',
  'unified.create': 'Create files',
  'unified.working': 'Creating...',
  'unified.downloadAgain': 'Download again',
  'unified.summaryTitle': 'Export summary (appendix 4, section 5.4)',
  'unified.typesTitle': 'Documents by type (section 2.6)',
  'unified.print': 'Print',
  'unified.error': 'Could not create the unified file.',
  'reports.title': 'Reports',

  // Tabs
  'reports.tab.income': 'Income',
  'reports.tab.expenses': 'Expenses',
  'reports.tab.profitLoss': 'Profit and loss',
  'reports.tab.ceiling': 'Ceiling',
  'reports.tab.pack': 'Monthly pack',

  // Shared across tabs
  'reports.totalLabel': 'Total:',
  'reports.downloadCsv': 'Download CSV',
  'reports.downloadXlsx': 'Download XLSX',

  // Income tab
  'reports.income.colDate': 'Date',
  'reports.income.colType': 'Type',
  'reports.income.colClient': 'Client',
  'reports.income.colCurrency': 'Currency',
  'reports.income.colAmountIls': 'Amount ILS',
  'reports.income.empty': 'No income in this period',

  // Expenses tab
  'reports.expenses.colDate': 'Date',
  'reports.expenses.colSupplier': 'Supplier',
  'reports.expenses.colCategory': 'Category',
  'reports.expenses.colAmountIls': 'Amount ILS',
  'reports.expenses.empty': 'No expenses in this period',

  // Profit and loss tab
  'reports.profitLoss.title': 'Profit and loss by month',
  'reports.profitLoss.empty': 'Nothing in this period',
  'reports.profitLoss.colMonth': 'Month',
  'reports.profitLoss.colIncome': 'Income',
  'reports.profitLoss.colExpenses': 'Expenses',
  'reports.profitLoss.colNet': 'Net',
  'reports.profitLoss.netForPeriod': 'Net for the period:',
  'reports.profitLoss.advanceBaseTitle': 'Advance-payment base (cash received)',
  'reports.profitLoss.totalReceived': 'Total received:',

  // Ceiling tab
  'reports.ceiling.emptyTitle': 'No ceiling set',
  'reports.ceiling.emptyDescription': 'Add a ceiling row in Settings for this year.',
  'reports.ceiling.turnoverToDate': 'Turnover to date',
  'reports.ceiling.openPaymentRequests': 'Open payment requests',
  'reports.ceiling.legalMode': 'Legal mode',
  'reports.ceiling.legalModePatur': 'עוסק פטור',
  'reports.ceiling.legalModeMurshe': 'עוסק מורשה',

  // Monthly pack tab
  'reports.pack.description': 'A PDF summary, an XLSX detail export and a ZIP of expense files, one per calendar month.',
  'reports.pack.running': 'Running...',
  'reports.pack.runNow': 'Run this month now',
  'reports.pack.runError': 'Could not run the pack.',
  'reports.pack.emptyTitle': 'No pack yet',
  'reports.pack.emptyDescription': 'The pack runs automatically on the 5th of every month.',
  'reports.pack.colPeriod': 'Period',
  'reports.pack.colIncome': 'Income',
  'reports.pack.colExpenses': 'Expenses',
  'reports.pack.colExpenseFiles': 'Expense files',
  'reports.pack.colEmailed': 'Emailed',
  'reports.pack.statusSent': 'Sent',
  'reports.pack.statusFailed': 'Failed',
  'reports.pack.statusNotSent': 'Not sent',
};
