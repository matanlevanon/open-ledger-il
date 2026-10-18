# Every feature

For a עוסק פטור today and a עוסק מורשה tomorrow.

Feature list

## Every feature

What ships today, grouped by job.

### Documents

- Quotes, payment requests and pro formas (חשבון עסקה)
- Receipts and credit receipts as עוסק פטור
- Tax invoices, invoice/receipts and credit invoices as עוסק מורשה
- English or bilingual Hebrew and English documents
- Duplicate any document in one click
- Create a receipt from any open document, with its payment filled in
- Cheque payments with bank, branch and account number
- Delete a draft only after you confirm

### Numbering and compliance

- One gapless series per document type, with your own starting numbers
- Final documents locked by database triggers and a hash chain
- PDF with your logo and signature, sealed with a PAdES digital signature
- Documents go out by email or WhatsApp only with the secured signature, as instruction 18ב requires
- ITA allocation numbers (מספר הקצאה), sandbox and production, with a retry queue
- פטור ceiling meter with alerts and a guided switch to מורשה
- Issuing on/off switch, to keep issuing in your current system

### Currency

- Documents in ILS, USD, EUR and other currencies
- Bank of Israel rates, cached daily
- A receipt takes the rate of the document it pays
- Type your own rate, or tick "use latest rate"
- Foreign and ILS totals printed in their own columns
- Client balances kept in the client’s currency

### Sending

- Email with To, CC and BCC on every document
- A CC list per client and a BCC copy list for your own records
- WhatsApp short link that opens a preview page with your logo
- A ready greeting in English or Hebrew, by the client’s language
- Digital-document consent recorded per client
- Payment reminders before and after the due date
- A clear confirmation once a document is marked as sent

### Recurring documents

- Weekly, monthly, quarterly or yearly schedules for retainers and pro formas
- Payment terms in days, set on each copy
- An end date to stop the schedule
- Issue and email on its own, or wait for your approval
- Approvals page on the computer and the phone
- Slack notice when a copy waits for approval

### Clients and dashboard

- A page per client with contacts, documents and a ledger per currency
- Open balances, aging and an overdue list
- Create a receipt straight from the overdue card
- Cash flow, income by month and top clients
- Sortable tables, newest first by default

### Contracts and work orders

- Contract and work order templates with fields you define, in English and Hebrew
- Service Agreement included in the first work order, signed once
- Client signs on the phone or the computer: fill in, draw, confirm with an email code
- Signed PDF with an evidence page and a certified PAdES signature
- Work order numbers on their own series, filled in for you
- Signing reminders, and contracts signed elsewhere uploaded to the client record
- Turn a signed work order into a pro forma

### Business documents

- VAT and company certificates, bookkeeping and withholding confirmations
- Claude reads the type, names and dates
- Expiry warnings on the dashboard
- Your assistant and accountant open the same list

### Expenses and import

- Forward receipts by email to your private address, or let a Gmail filter do it
- Upload a receipt or snap a photo, Claude or Gemini reads supplier, date and amount
- Import a month of expenses from Google Drive
- Import customers and past documents from another system
- Imported documents keep the exchange rate printed on them, never a guessed one
- Documents with no printed rate are flagged for you to fill in

### Reports, exports and backups

- Income, expenses, profit and loss, open items and client ledgers
- Download as PDF, XLSX or CSV
- Monthly accountant pack and an accountant login with an end date and access log
- Unified file (מבנה אחיד) v1.31 for the Tax Authority
- PCN874 export (allocation-number column)
- Quarterly backups to R2 and Google Drive

### Claude and AI (MCP)

- Connect Claude Desktop or Claude Code with your Ledger address and a token
- Ask about balances and open documents, or have Claude draft documents you approve
- Hand Claude a supplier invoice and it records the expense for your review
- Settings > MCP: copy the address, make a new token when one is lost, or switch MCP off
- Document reading with your own Anthropic or Gemini key

### Install and updates

- A Windows installer sets up everything in your Cloudflare account in about 3 minutes
- Updates find your Ledger and keep the data, the keys and the business details
- Remembers your answers on your computer, and the Cloudflare token if you choose

### On your phone

- Installs on the home screen like an app
- Quick page: photo, gallery, new document and recent activity
- Bottom tab bar and tables that turn into cards
- Photos taken offline upload when you are back online

Screenshots

## What you get

**Documents and their relations.** Every document with its status, the documents it came from or led to, and what is still open.

**Payment requests that close.** Record a payment and the receipt links back to the request. Partial payments keep the rest open.

**Clients and their ledger.** One page per client with contacts, consent status, documents and a running ledger per currency.

**Expenses to review and file.** Documents read by Claude land in New. Check the supplier, amount and category, then file.

**Reports for you and your accountant.** Income, expenses, profit and loss, open items and ledgers. Download as PDF, XLSX or CSV.

**Your business, your brand.** Business details, logo, signature, payment methods and bank details printed on your documents.

The rules

## Six rules the code enforces

The database refuses to break them.

- **A final document never changes** A mistake is fixed with a credit document or a cancellation, never an edit. Database triggers block updates to a final row.
- **Numbers come only from finalize** Drafts carry no number, so a deleted draft never leaves a gap in the series.
- **No tax invoice PDF without its allocation number** When the ITA requires a מספר הקצאה, the PDF waits for it.
- **A demand and its receipt count once** A payment request or pro forma is a charge, the receipt is the income. Reports never add both.
- **Rates are dated** VAT, the פטור ceiling and exchange rates are stored with the date they apply from.
- **Sandbox and production never mix** ITA sandbox and production credentials, tokens and numbers are kept apart.

Source: https://open-ledger.dev/en/features/
