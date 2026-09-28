/**
 * Expenses feature strings (R16 task 16): expense upload/review, suppliers, categories, and
 * everything under web/src/features/expenses/. `expenses.list.*` covers the expenses list and
 * upload screen, `expenses.review.*` the single-expense review screen, `expenses.categories.*`
 * the categories screen, `expenses.suppliers.*` the suppliers screen, and `expenses.status.*`
 * the shared expense-status labels (used by both the list tabs and the status chip).
 */
export const expenses = {
  // Shared across this feature
  'expenses.backToExpenses': 'Back to expenses',
  'expenses.loading': 'Loading...',
  'expenses.common.dash': '—',

  // Expense status labels (list tabs and status chip)
  'expenses.status.new': 'New',
  'expenses.status.filed': 'Filed',
  'expenses.status.notExpense': 'Not an expense',
  'expenses.status.duplicate': 'Duplicate',
  'expenses.status.returned': 'Returned',

  // Expenses list (ExpensesListPage)
  'expenses.list.title': 'Expenses',
  'expenses.list.suppliersLink': 'Suppliers',
  'expenses.list.categoriesLink': 'Categories',
  'expenses.list.uploading': 'Uploading...',
  'expenses.list.uploadButton': 'Upload expense',
  'expenses.list.statusTablistLabel': 'Expense status',
  'expenses.list.tabAll': 'All',
  'expenses.list.loadError': 'Could not load expenses.',
  'expenses.list.uploadError': 'Upload failed. Try a smaller file or a supported format (PDF, JPG, PNG).',
  'expenses.list.empty': 'No expenses here yet.',
  'expenses.list.colDate': 'Date',
  'expenses.list.colSupplier': 'Supplier',
  'expenses.list.colDocument': 'Document',
  'expenses.list.colAmount': 'Amount',
  'expenses.list.colAmountIls': 'In ILS',
  'expenses.list.colCategory': 'Category',
  'expenses.list.colStatus': 'Status',
  'expenses.list.supplierFallback': 'Supplier #{id}',

  // Expense review (ExpenseReviewPage)
  'expenses.review.title': 'Review expense',
  'expenses.review.fileIframeTitle': 'Expense document',
  'expenses.review.noFile': 'No file attached.',
  'expenses.review.supplierLabel': 'Supplier',
  'expenses.review.supplierIdFallback': '#{id}',
  'expenses.review.categoryLabel': 'Category',
  'expenses.review.noCategoryOption': 'No category',
  'expenses.review.documentNumberLabel': 'Document number',
  'expenses.review.documentDateLabel': 'Document date',
  'expenses.review.currencyLabel': 'Currency',
  'expenses.review.amountLabel': 'Amount',
  'expenses.review.vatAmountLabel': 'VAT amount',
  'expenses.review.fxRateNote': '{amount} at {rate} ({source})',
  'expenses.review.homeCurrencyFallback': 'home currency',
  'expenses.review.notesLabel': 'Notes',
  'expenses.review.fileButton': 'File',
  'expenses.review.notExpenseButton': 'Not an expense',
  'expenses.review.markDuplicateButton': 'Mark duplicate',
  'expenses.review.returnReasonPlaceholder': 'Reason for returning',
  'expenses.review.returnButton': 'Return',
  'expenses.review.saveError': 'Could not save. Check the amount and VAT fields.',
  'expenses.review.reasonRequiredError': 'A returned expense needs a reason.',
  'expenses.review.statusUpdateError': 'Could not update the status.',

  // Categories (CategoriesPage)
  'expenses.categories.title': 'Categories',
  'expenses.categories.namePlaceholder': 'New category name',
  'expenses.categories.addButton': 'Add category',
  'expenses.categories.addError': 'Could not add the category.',
  'expenses.categories.deactivate': 'Deactivate',
  'expenses.categories.activate': 'Activate',

  // Suppliers (SuppliersPage)
  'expenses.suppliers.title': 'Suppliers',
  'expenses.suppliers.namePlaceholder': 'Name',
  'expenses.suppliers.taxIdPlaceholder': 'VAT or company ID',
  'expenses.suppliers.addButton': 'Add supplier',
  'expenses.suppliers.addError': 'Could not add the supplier.',
  'expenses.suppliers.empty': 'No suppliers yet.',
  'expenses.import.counts': '{month} from {source}: {seen} seen, {created} created, {duplicate} skipped as duplicate, {notExpense} skipped as not an expense, {self} issued by this business, {errors} errors.',
  'expenses.import.sourceSheet': 'the index sheet',
  'expenses.import.sourceFolder': 'the month folder',
  'expenses.import.sourceNone': 'nothing. No sheet or folder found',
  'expenses.import.sourceFailed': 'Drive. The run failed',
  'expenses.import.statusCounts': 'Sheet rows by status:',
  'expenses.import.reasonDriveFile': 'this Drive file is already in the ledger',
  'expenses.import.reasonFileHash': 'the same file is already in the ledger',
  'expenses.import.reasonSupplierNumber': 'same supplier and document number',
  'expenses.import.reasonSupplierDateTotal': 'possible duplicate with the same supplier, date and total. Not created',
  'expenses.import.reasonIssuedBySelf': 'issued by this business, not an expense',
  'expenses.import.matchedExpense': 'Expense {id}',
  'expenses.import.button': 'Import month',
  'expenses.import.running': 'Importing',
  'expenses.import.monthLabel': 'Month to import',
  'expenses.import.error': 'The import failed.',
};
