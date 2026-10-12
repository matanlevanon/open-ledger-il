# Changelog

## 1.4.0 (2026-10-13)

### Business type
- עוסק פטור, עוסק מורשה or חברה בע"מ, chosen on the first-run setup screen. Settings > Tax shows the
  type, and a פטור business switches to מורשה from there, with the word מורשה typed to confirm.
- The switch is one way. Database triggers refuse any change back to פטור.
- The dashboard follows the type: the ceiling card for פטור, the VAT due card with its period and
  report date for מורשה and companies.

### Several businesses in one Ledger
- One עוסק and any number of companies. Add a business from the top-bar switcher or Settings >
  Businesses. Each business has its own numbering, hash chain, Tax Authority login and exports.
- Brands: the name, tagline and contacts a document prints, per business.
- Roles per business: owner, assistant, accountant.

### Business documents
- Settings > Business documents: upload certificates, read the name and number from them, view,
  download, and share with a link that expires and can be revoked. Reminders before a certificate ends.

### Other
- Expense and invoice reading works with an Anthropic key or a Gemini key (AI_PROVIDER).
- Settings > Updates checks for a new release, and a monthly check posts to Slack (UPDATE_REPO).
- The business form accepts an empty email, and a refused save names the field.
- Every file is written once, so the 7-year bucket lock never blocks the Ledger.
- The ita-auth broker keeps its clients in D1, registers new installs by itself, and has an admin page.

## 1.3.0 (2026-10-08)

### Tax Authority (allocation numbers)
- Login broker. tools/ita-auth is a Worker that keeps one ITA API app's client secret for several
  installs. An install with ITA_BROKER_URL, ITA_BROKER_CLIENT and ITA_BROKER_KEY signs in and
  renews through it, with no client id or secret of its own. Invoice calls still go straight to
  the ITA. Check route probes the broker too. docs/deploy.md, Option 4.
- The production token call goes to ita-api.taxes.gov.il.
- A "?" on Check route and Test renewal explains each one.

### Layout
- One page scroll instead of a scroll box inside the page. A footer on every screen.

## 1.2.0 (2026-10-08)

### Tax Authority (allocation numbers)
- Manual mode. With no ITA API app set up, the Ledger never calls the Tax Authority. An invoice
  that needs an allocation number waits on the ITA screen. Copy details puts the invoice details
  on the clipboard for the ITA web app, and the number is typed back in. A number still missing
  after 24 hours raises one Slack alert. docs/deploy.md, Option 3.
- Queue rows carry the client's VAT number and the total with VAT.

## 1.1.0 (2026-10-07)

### Tax Authority (allocation numbers)
- Sandbox token and API calls moved to `ita-api.taxes.gov.il`, per the SHAAM address notice.
- The login lasts 90 days. No nightly renewal: Slack reminders on days 75, 85 and 89, a banner
  from day 80, and a reconnect on day 90. The access token renews when a call needs it.
- Check route tests the path to the Tax Authority without a login. Test renewal renews on demand.
  Both say which data center the call left from.
- Refused logins and renewals record the Tax Authority's reason and the data center.
- Optional relay with a fixed Israeli address, in `tools/ita-relay`, for when Cloudflare serves
  you from outside Israel. docs/deploy.md, "Reaching the Tax Authority", starts with the
  Cloudflare-only route.

### Documents and money
- A credit invoice's line carries the amount before VAT, so its lines add up to its subtotal. The
  refund keeps the full amount.
- Unified file (מבנה אחיד) passes the Tax Authority checker's structure and totals checks. A demo file with
  the two printouts for software registration: `npm run demo:unified-file`.
- A receipt takes the exchange rate of the document it pays. Imported documents keep the rate
  printed on them. A receipt rate typed by hand overrides both.
- Recurring documents wait on an approvals page, with a Slack notice and payment terms.
- CC and BCC on document emails, a short WhatsApp link with a preview, sortable document tables.
- Create a receipt from the dashboard's Overdue and open card.
- An owner switch turns document issuing off, for anyone who keeps issuing in their current system.

### Interface
- A collapsible Income section in the sidebar that remembers its state. Quick is "פעולות מהירות"
  in Hebrew.
- A phone Quick page with receipt capture, issue buttons and recent activity.

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
