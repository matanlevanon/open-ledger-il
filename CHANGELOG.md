# Changelog

## 1.0.0 (2026-09-29)

The first public release of MTN - Open Ledger IL: invoicing, expenses and books for an Israeli
business, on your own Cloudflare account.

### Documents
- Quotes, payment requests, pro formas (חשבון עסקה), receipts and credit receipts as עוסק פטור.
- Tax invoices, invoice/receipts and credit invoices as עוסק מורשה, with ITA allocation numbers
  (Israel Invoices API v2, sandbox and production, retry queue).
- Legal numbering: one series per type, no gaps, no reuse, final documents never change. A hash
  chain and database triggers enforce both.
- Signed PDFs (PAdES) with your logo and signature, English or bilingual.
- Duplicate any document. Recurring documents, weekly to yearly, held for approval or issued and
  emailed automatically.
- Email and WhatsApp sending with recorded digital-document consent, and payment reminders.

### Money
- Bank of Israel rates, cached daily. A rate carried from a payment request to its receipt.
- Client ledgers where a demand is closed by the receipt that pays it, open items and aging.
- The פטור ceiling meter with alerts and a guided switch to עוסק מורשה.

### Expenses, reports and access
- Expenses by upload or a monthly Google Drive import, read by Claude, reviewed and filed.
- Income, expenses, profit and loss, services, per-client ledgers and a monthly accountant pack.
- An accountant role with per-feature switches, an end date and an access log.
- The unified file (מבנה אחיד), PCN874 (allocation-number column), quarterly backups.
- Import of customers (CSV) and past documents (PDF), with a document type and a service each.

### Running it
- One Cloudflare Worker with D1 and R2, signed in through Cloudflare Access.
- Five cron triggers, within the Workers Free plan limit.
- A phone layout: bigger text and buttons, a bottom tab bar, tables shown as cards.
- A product page in English and Hebrew, published from `/docs` with GitHub Pages.
