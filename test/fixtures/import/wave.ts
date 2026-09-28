/** Synthetic Wave-style CSV exports (runs/_common.md: never real client data). */

export const WAVE_CUSTOMERS_CSV = [
  'Customer Name,Email,Phone,Currency,Country,Business Number',
  '"Example Client Ltd",contact@client.example,+972-50-0000000,EUR,IL,514000000',
  '"Northwind Traders, Inc.",billing@northwind.example,+1-555-0100,USD,US,',
  'Solo Client,,,USD,US,',
].join('\r\n');

export const WAVE_INVOICES_CSV = [
  'Invoice Number,Customer,Invoice Date,Currency,Amount,Status',
  '301,Example Client Ltd,2025-10-15,EUR,480.00,Overdue',
  '302,"Northwind Traders, Inc.",2025-11-15,USD,"1,250.00",Paid',
].join('\r\n');
