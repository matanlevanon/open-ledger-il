# Accountant access

Your accountant logs in with a personal account and sees a limited set of features. You grant and revoke access from Settings.

## Login

- Cloudflare Access policy with two rules: your Google account (role `owner`) and the accountant's email (role `accountant`), one-time PIN by email or the accountant's Google account.
- The Worker reads the Access identity header and maps the email to a role in the `users` table. Unknown emails get 403.
- Access has an end date. Default: 12 months, renewable. A Slack reminder fires 14 days before expiry.

## Feature switches per accountant

You pick which switches are on. Defaults in brackets.

| Feature | Accountant can | Default |
|---|---|---|
| Income documents | view, download PDFs | on |
| Expenses | view files, set status (filed, returned with reason, not an expense), set category | on |
| Clients | view name, ID, country, balance | on |
| Reports | income, expenses, VAT summary, profit and loss, ceiling meter, advance-payment base | on |
| Monthly pack | download PDF summary, XLSX detail, ZIP of expense files | on |
| Unified file (מבנה אחיד) | export for any period | on |
| PCN874 | export | on, after the switch |
| Bank matches | view | off |
| Notes | leave a note on any document or expense, visible to you | on |

## Never available to the accountant

- Issuing, cancelling or crediting any document
- Settings, numbering, business details
- ITA connection, tokens, allocation requests
- User management
- Quotes and pipeline data (commercial, not bookkeeping)

## Controls

- Every accountant action writes to `audit_log`: who, what, when, from which IP.
- Downloads are signed R2 URLs valid for 10 minutes.
- Revoke works at once: the role row is deleted and the Access policy updated.
- The Monthly pack also goes out by email on the 5th, so access is optional for routine months.

## Why this shape

SUMIT gives the accountant a fixed role with full view and edit rights on accounting data. Open Ledger IL keeps the view rights, limits edits to expense status and category, and adds per-feature switches, an end date and a full access log.
