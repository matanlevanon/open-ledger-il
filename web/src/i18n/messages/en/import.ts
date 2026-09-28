/**
 * Import feature strings (R16 task 16): the Import screen (Wave customers, Wave invoices, SUMIT
 * unified file, series starting numbers) under web/src/features/import/.
 * `import` is a reserved word, so the exported binding is named `importFeature`.
 */
export const importFeature = {
  // ImportPage.tsx
  'import.page.title': 'Import',
  'import.page.subtitle': 'One-time migration from Wave and SUMIT. Clients and history import any number of times without duplicating rows.',
  'import.page.tabsAriaLabel': 'Import source',
  'import.tab.customers': 'Wave customers',
  'import.tab.invoices': 'Wave invoices',
  'import.tab.sumit': 'SUMIT unified file',
  'import.tab.uploads': 'Upload existing documents',
  'import.tab.numbering': 'Series numbers',

  'import.uploads.title': 'Upload existing documents',
  'import.uploads.hint': 'A document issued in SUMIT, Wave or another system before Open Ledger IL. It never takes a number in Open Ledger IL’s own series.',
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

  // Wave customers tab (fields passed to CsvImportSection)
  'import.waveCustomers.title': 'Wave customers',
  'import.waveCustomers.hint': 'Export customers as CSV from Wave (Customers > Import or export), then map the columns below.',
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

  // Wave invoices tab (fields passed to CsvImportSection)
  'import.waveInvoices.title': 'Wave invoices',
  'import.waveInvoices.hint':
    "Export the invoice history as CSV from Wave. These become read-only history rows, outside Open Ledger IL's own numbered series.",
  'import.waveInvoices.field.externalId': 'Invoice number',
  'import.waveInvoices.field.clientName': 'Customer name',
  'import.waveInvoices.field.docDate': 'Invoice date',
  'import.waveInvoices.field.currency': 'Currency',
  'import.waveInvoices.field.amount': 'Amount',
  'import.waveInvoices.field.status': 'Status',

  // CsvImportSection.tsx
  'import.csv.chooseFile': 'Choose a CSV file',
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

  // SumitImportSection.tsx
  'import.sumit.title': 'SUMIT unified-file export',
  'import.sumit.hint':
    'Upload the ZIP with INI.TXT and BKMVDATA.TXT. C100, D110 and D120 records are kept as history rows. The field layout inside each record is not decoded yet (no unified-file spec on file), so the raw line is kept for later.',
  'import.sumit.chooseFile': 'Choose a ZIP file',
  'import.sumit.readError': 'Could not read this ZIP. It must contain INI.TXT and BKMVDATA.TXT.',
  'import.sumit.recordsFound': '{count} records found:',
  'import.sumit.recordCount': '{type}: {count}',
  'import.sumit.importing': 'Importing...',
  'import.sumit.importButton': 'Import',
  'import.sumit.importFailed': 'Import failed.',
  'import.sumit.importedToast': 'Imported {created} records ({skipped} already imported).',
  'import.sumit.summaryLine': '{created} records imported, {skipped} already imported before.',

  // SeriesStartSection.tsx
  'import.series.title': 'Series starting numbers',
  'import.series.hint':
    'Continue each series from where SUMIT left off. Look up the last number SUMIT issued per document type, then confirm it here. A series with a document already issued cannot be changed.',
  'import.series.colType': 'Type',
  'import.series.colNextNumberNow': 'Next number now',
  'import.series.colStatus': 'Status',
  'import.series.colSetNextNumberTo': 'Set next number to',
  'import.series.statusLocked': 'In use, locked',
  'import.series.statusNotStarted': 'Not started yet',
  'import.series.confirm': 'Confirm',
  'import.series.invalidNumber': 'Enter a whole number of 1 or more.',
  'import.series.confirmDialog': "Set {id}'s next number to {value}? This cannot be undone once a document is issued.",
  'import.series.setReason': 'Set from the last SUMIT number, {date}',
  'import.series.setSuccess': '{id} will start at {value}.',
  'import.series.setError': 'Could not set the starting number for {id}.',
};
