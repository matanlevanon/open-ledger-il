# Changelog

Every release, newest first. The current version is 1.6.0.

## 1.6.0 (2026-10-13)

### Expenses

- An expense the reader could not read shows "Not read automatically" with the reason and a **Read again** button, and a **Not read** badge in the list. Fields already typed stay. The daily cron reads such expenses again, up to 10 a business, 4 reads in all, for 30 days, and stops when the AI provider is busy. Migration `3900_expense_read.sql`.
- A busy AI provider (429, 5xx) gets a pause of 3 seconds, or its Retry-After up to 8, before the one retry. The note then says "<Provider> is busy right now (HTTP n)."
- MCP `list_expenses` returns `readStatus`.

### People

- A business always keeps one active owner. The only owner has no Remove button and a locked role. The server answers 409 `last_owner`. Errors show in the row, and the table stays.

### Documents

- A shekel document prints one total column. It printed "סה"כ לתשלום (₪)" twice. The shekel column and the two-column totals now show only on a USD, EUR or GBP document.

### Tax Authority connection

- An install that signs in through a login broker now sends every Tax Authority call through that broker too: invoice approvals, details and decisions. The broker checks the install on each call, so pausing an install there stops it within minutes.
- With a broker set, the install ignores its own relay settings. It needs no relay token.
- Installs with their own ITA API app, with or without their own relay, work as before.

### Login broker (tools/ita-auth)

- New `/ita/*` route forwards an install's Tax Authority calls with the relay's path and header rules, through the relay when one is set. It never logs bodies or tokens.
- Optional licence keys: with `LICENCE_URL` and `LICENCE_SECRET` set, an install registers with a licence key, and each call checks the licence, cached for 10 minutes. Each check reports the install name and its call count since the last check.
- Migration `0002_licences.sql` adds the licence columns. Installs with no licence keep working.
- The admin page shows each install's licence last 4, or "no licence".

### Demo mode

- Visitors enter at once. Every visitor reads the same sample businesses, and nothing is copied on entry.
- The sample data is read-only for visitors. The server refuses every change to it, and the app says "Read-only in the demo" next to the buttons it hides.
- Visitors keep private drafts: documents, clients, contracts and expense uploads. Nobody else sees them. They are deleted 30 minutes after the visitor leaves, and every night.
- Issue, Send, Record payment and Sign show previews. A preview PDF carries the number 0000 and a watermark. Nothing is numbered, sent or stored as signed.
- The reset Worker runs every 15 minutes. It sweeps ended visits, and at 03:00 Israel time it rebuilds the sample set if it changed. One build runs at a time.
- The demo shows its own product name in the sidebar and in the browser tab.
- The demo opens light and in Hebrew. The start page remembers the language picked there.
- The start page now shows on every path, deep links included.
- `/admin` runs on the Worker. `keep_vars` sits at the top level of `wrangler.toml`, so variables set in the dashboard survive a deploy.
- Demo visitors see a working Tax Authority connection on the fake.

### Dashboard

- The Tax Authority card reads the real connection state, in English and Hebrew.

### MCP

- Settings > MCP shows the MCP address, makes a new token and shows it once, and turns MCP off. A token made there replaces the Worker secret `MCP_TOKEN`. Owner only.

### Expenses

- Forward receipts by email. Each PDF or image attachment becomes an expense waiting for review. Only senders on the list count. Settings > Expenses > Email inbox shows the address, the senders, the Gmail confirmation code and the setup steps. A Ledger on its own domain takes email through Email Routing with no gateway. The gateway is `tools/ledger-inbox`.

### Database

- Migration 3500: `inbox_signatures` and `inbox_events`, for the email inbox.
- Migration 3400: `mcp_tokens`, the token made in Settings > MCP, stored as its SHA-256 only.
- Migration 2900: demo session tags on the demo tables, the build lock and the sweep log.

## 1.5.0 (2026-10-13)

### Contracts and work orders

- Contracts and work orders with Fill & Sign: versioned templates in English and Hebrew, fields filled from the client and the business, a signing link with an email code, and a signed PDF with an evidence page and a certifying signature.
- Two neutral starter templates: a Service Agreement with standing terms for the whole relationship, and a Work Order for each project. Have a lawyer review them before use.
- A first engagement sends the Service Agreement and the Work Order as one PDF, signed once. The work order's terms date fills with the signing date.
- Fields can number themselves from a starting value like `WO-{YYYY}-{NNN}`.
- File a contract signed on paper or elsewhere, with its PDF. It is stored write-once.
- Automatic signing reminders from the 07:00 run, set in Settings > Email > Reminders.
- The new contract screen starts on the Work Order, marks missing fields in red and shows the error next to Send. Remind asks how to send. The contract page opens with an overview.
- A pro forma made from a work order names its number in the notes.

### Signing

- The signing page shows the contract as a web page with a Sign button, light, and full width on a computer. The PDF has a Sign button in each client signature box until it is signed.
- Signing codes last 15 minutes, a new code waits a minute, earlier codes keep working, and five wrong tries lock them.
- Signing dates use the date in Israel.
- Adobe Reader shows the certification as valid and the document as not modified.

### Clients and reminders

- A switch per client for automatic reminders, and a Reminders list on the client page.
- Payment reminders respect the switch and are logged.
- Reminders due on WhatsApp show on the dashboard.
- Default payment methods per client, used first on a new document.
- A Back link on every page below another. The contract Record card folds.

### Demo mode

- `DEMO_MODE=1` turns a Ledger into a public demo: a gate, a private sandbox per visitor, a watermark on every PDF, a fake Tax Authority, email previews, daily caps, an admin page and a nightly reset Worker. The same rules and locks as a real Ledger. See docs/demo-mode.md.
- Lead capture is optional and posts to a webhook you choose. The consent text is a setting.

## 1.4.0 (2026-10-13)

### Business type

- עוסק פטור, עוסק מורשה or חברה בע"מ, chosen on the first-run setup screen. Settings > Tax shows the type, and a פטור business switches to מורשה from there, with the word מורשה typed to confirm.
- The switch is one way. Database triggers refuse any change back to פטור.
- The dashboard follows the type: the ceiling card for פטור, the VAT due card with its period and report date for מורשה and companies.

### Several businesses in one Ledger

- One עוסק and any number of companies. Add a business from the top-bar switcher or Settings > Businesses. Each business has its own numbering, hash chain, Tax Authority login and exports.
- Brands: the name, tagline and contacts a document prints, per business.
- Roles per business: owner, assistant, accountant.

### Business documents

- Settings > Business documents: upload certificates, read the name and number from them, view, download, and share with a link that expires and can be revoked. Reminders before a certificate ends.

### Other

- Expense and invoice reading works with an Anthropic key or a Gemini key (AI_PROVIDER).
- Settings > Updates checks for a new release, and a monthly check posts to Slack (UPDATE_REPO).
- The business form accepts an empty email, and a refused save names the field.
- Every file is written once, so the 7-year bucket lock never blocks the Ledger.
- The ita-auth broker keeps its clients in D1, registers new installs by itself, and has an admin page.

## 1.3.0 (2026-10-08)

### Tax Authority (allocation numbers)

- Login broker. tools/ita-auth is a Worker that keeps one ITA API app's client secret for several installs. An install with ITA_BROKER_URL, ITA_BROKER_CLIENT and ITA_BROKER_KEY signs in and renews through it, with no client id or secret of its own. Invoice calls still go straight to the ITA. Check route probes the broker too. docs/deploy.md, Option 4.
- The production token call goes to ita-api.taxes.gov.il.
- A "?" on Check route and Test renewal explains each one.

### Layout

- One page scroll instead of a scroll box inside the page. A footer on every screen.

## 1.2.0 (2026-10-08)

### Tax Authority (allocation numbers)

- Manual mode. With no ITA API app set up, the Ledger never calls the Tax Authority. An invoice that needs an allocation number waits on the ITA screen. Copy details puts the invoice details on the clipboard for the ITA web app, and the number is typed back in. A number still missing after 24 hours raises one Slack alert. docs/deploy.md, Option 3.
- Queue rows carry the client's VAT number and the total with VAT.

## 1.1.0 (2026-10-07)

### Tax Authority (allocation numbers)

- Sandbox token and API calls moved to `ita-api.taxes.gov.il`, per the SHAAM address notice.
- The login lasts 90 days. No nightly renewal: Slack reminders on days 75, 85 and 89, a banner from day 80, and a reconnect on day 90. The access token renews when a call needs it.
- Check route tests the path to the Tax Authority without a login. Test renewal renews on demand. Both say which data center the call left from.
- Refused logins and renewals record the Tax Authority's reason and the data center.
- Optional relay with a fixed Israeli address, in `tools/ita-relay`, for when Cloudflare serves you from outside Israel. docs/deploy.md, "Reaching the Tax Authority", starts with the Cloudflare-only route.

### Documents and money

- A credit invoice's line carries the amount before VAT, so its lines add up to its subtotal. The refund keeps the full amount.
- Unified file (מבנה אחיד) passes the Tax Authority checker's structure and totals checks. A demo file with the two printouts for software registration: `npm run demo:unified-file`.
- A receipt takes the exchange rate of the document it pays. Imported documents keep the rate printed on them. A receipt rate typed by hand overrides both.
- Recurring documents wait on an approvals page, with a Slack notice and payment terms.
- CC and BCC on document emails, a short WhatsApp link with a preview, sortable document tables.
- Create a receipt from the dashboard's Overdue and open card.
- An owner switch turns document issuing off, for anyone who keeps issuing in their current system.

### Interface

- A collapsible Income section in the sidebar that remembers its state. Quick is "פעולות מהירות" in Hebrew.
- A phone Quick page with receipt capture, issue buttons and recent activity.

## 1.0.0 (2026-09-29)

The first public release of MTN - Open Ledger IL: invoicing, expenses and books for an Israeli business, on your own Cloudflare account.

### Documents

- Quotes, payment requests, pro formas (חשבון עסקה), receipts and credit receipts as עוסק פטור.
- Tax invoices, invoice/receipts and credit invoices as עוסק מורשה, with ITA allocation numbers (Israel Invoices API v2, sandbox and production, retry queue).
- Legal numbering: one series per type, no gaps, no reuse, final documents never change. A hash chain and database triggers enforce both.
- Signed PDFs (PAdES) with your logo and signature, English or bilingual.
- Duplicate any document. Recurring documents, weekly to yearly, held for approval or issued and emailed automatically.
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

Source: https://open-ledger.dev/en/changelog/
