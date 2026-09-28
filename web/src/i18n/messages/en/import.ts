/**
 * Import feature strings: the Import screen (existing customers from a CSV, past invoices as PDFs)
 * under web/src/features/import/.
 * `import` is a reserved word, so the exported binding is named `importFeature`.
 */
export const importFeature = {
  // ImportPage.tsx
  'import.page.title': 'Import',
  'import.page.subtitle': 'Bring your existing customers and past invoices into Open Ledger IL. Importing again never duplicates rows.',
  'import.page.tabsAriaLabel': 'Import source',
  'import.tab.customers': 'Existing customers',
  'import.tab.uploads': 'Past invoices',

  'import.uploads.title': 'Past invoices',
  'import.uploads.hint': 'A document you issued in another system before Open Ledger IL. It never takes a number in Open Ledger IL’s own series.',
  'import.uploads.chooseFiles': 'Choose PDF files',
  'import.uploads.uploading': 'Uploading',
  'import.uploads.extractionFailed': 'Automatic reading failed ({message}). Fill the fields in by hand.',
  'import.uploads.filed': 'Filed as external document #{id}.',
  'import.uploads.field.source': 'Source system',
  'import.uploads.field.documentType': 'Document type',
  'import.uploads.field.originalNumber': 'Original number',
  'import.uploads.field.issueDate': 'Issue date',
  'import.uploads.field.client': 'Matched client',
  'import.uploads.field.noClientMatch': 'No match',
  'import.uploads.field.clientName': 'Client name (as printed)',
  'import.uploads.field.clientTaxId': 'Client tax ID',
  'import.uploads.field.currency': 'Currency',
  'import.uploads.field.amountBeforeVat': 'Amount before VAT',
  'import.uploads.field.vatAmount': 'VAT',
  'import.uploads.field.total': 'Total',
  'import.uploads.field.paidStatus': 'Paid status',
  'import.uploads.createClient': 'Create a new client with this name',
  'import.uploads.fileButton': 'File this document',

  // Existing customers tab (fields passed to CsvImportSection)
  'import.waveCustomers.title': 'Existing customers',
  'import.waveCustomers.hint': 'Export your customers as a CSV file from any system, then match its columns below.',
  'import.waveCustomers.field.nameEn': 'Client name',
  'import.waveCustomers.field.nameHe': 'Hebrew name',
  'import.waveCustomers.field.companyId': 'Company ID / VAT number',
  'import.waveCustomers.field.vatNumber': 'VAT number (if separate)',
  'import.waveCustomers.field.country': 'Country (2-letter code)',
  'import.waveCustomers.field.currency': 'Currency',
  'import.waveCustomers.field.email': 'Email',
  'import.waveCustomers.field.phone': 'Phone',
  'import.waveCustomers.field.addressEn': 'Address',
  'import.waveCustomers.field.notes': 'Notes',


  // CsvImportSection.tsx
  'import.csv.chooseFile': 'Choose a CSV file',
  'import.csv.cancelButton': 'Cancel',
  'import.csv.readError': 'Could not read this file. Check it is a CSV export.',
  'import.csv.rowsFound': '{count} rows found. Map each field to a column, then import.',
  'import.csv.noColumn': 'No column',
  'import.csv.importing': 'Importing...',
  'import.csv.importButton': 'Import',
  'import.csv.importFailed': 'Import failed. Check the field mapping and try again.',
  'import.csv.importedToast': 'Imported: {created} created, {updated} updated, {skipped} skipped.',
  'import.csv.summaryLine': '{total} rows: {created} created, {updated} updated, {skipped} skipped.',
  'import.csv.rowError': 'Row {row}: {message}',
  'import.csv.andMore': 'and {count} more...',


};
