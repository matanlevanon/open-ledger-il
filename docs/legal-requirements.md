# Legal requirements mapped to features

Framework: הוראות מס הכנסה (ניהול פנקסי חשבונות), תשל"ג-1973, the VAT law and the Israel Invoices regulation. Items marked CONFIRM need a check with your accountant.

## Applies in both statuses

| Rule | Source | Open Ledger IL feature |
|---|---|---|
| Receipt for every payment, issued close to payment | Instructions 5, 17 | Recording a payment issues the receipt in the same step |
| One continuous number series per document type, no gaps, no deletion | Computerized-books rules, appendix to instruction 36 | Number assigned at finalize inside a transaction. D1 triggers block UPDATE and DELETE on final rows. Nightly gap check |
| Corrections by credit document or cancellation mark only | Instruction 18 | Two actions: Cancel (unsent, marked בוטל, copy kept) and Credit |
| Original issued once, later copies marked | Practice, SUMIT behavior | "מקור" on first render, "העתק נאמן למקור" after |
| Records in Hebrew or Arabic | Instruction 21 | English interface. Filed copy bilingual. Client copy in English with both currencies |
| Records in shekels, currency and foreign amount stated | Instruction 22 | Each line stores foreign amount, currency, BOI representative rate of the payment date, fallback last rate before, ILS amount |
| Digital delivery: notice to assessor by registered mail before the first digital document, client consent, secured electronic signature | Instruction 18ב, 25(ז2) | Consent record per client. PAdES signature on every PDF with a self-managed key (secured signature). Payment methods limited to card, crossed cheque, bank transfer per 18ב(ד). Send blocked without consent |
| Retention: 7 years from year end or 6 years from filing, the later | Instruction 25 | R2 with object lock, no purge code |
| Quarterly backup, first week of the quarter, stored away from the system | Instruction 25(ו) | Cron export to Google Drive plus restore test |
| Software registration | ITA registration service, appendix to instruction 36 | Not required for own use. Required the day anyone else uses the system |

## Bookkeeping appendix: תוספת ה׳

Records required on top of the common set for a service provider on a cash basis: receipts and payments book (single entry) and a client book with a separate account per client. Open Ledger IL: per-client ledger view (every document and payment, running balance per currency), printable per period, included in the accountant pack.

## עוסק פטור, until the confirmed switch

| Rule | Open Ledger IL feature |
|---|---|
| No tax invoices | Document set: receipt, חשבון עסקה, payment request, quote, credit |
| "עוסק פטור" and ID number on documents | Header template |
| Annual ceiling: ₪122,833 in 2026. 2027 figure CPI-linked, published around January | Ceiling table with one row per year, entered by you |

## Switch from פטור to מורשה

The switch happens when 2027 turnover reaches the ceiling, never on a fixed date, never automatically.

Law, per secondary sources (primary text not verified):
- VAT applies to transactions from the moment turnover crosses the ceiling. Earlier transactions stay exempt.
- The test looks at expected turnover, not only money received.
- Notice to the VAT office within 15 days of the event. VAT registration regulation 8(א): https://www.btl.gov.il/Laws1/02_0022_100001.pdf
- Sources: https://www.kolzchut.org.il/he/עוסק_פטור and https://www.bizportal.co.il/guides/news/article/20039570

Ceiling guard:
1. Meter: turnover to date plus open payment requests, against the year's ceiling.
2. Alerts to Slack and the dashboard at 70, 85 and 95 percent, and when turnover plus open requests passes 100 percent.
3. Crossing block: a receipt whose amount takes turnover past the ceiling stops before finalize. The screen shows turnover, ceiling and the gap, with three actions:
   - Confirm switch. You set the effective date. The פטור series close. The document re-opens as a חשבונית מס/קבלה with VAT.
   - Issue as פטור. Allowed only while turnover stays at or under the ceiling after this document.
   - Cancel.
4. After confirmation: a 15-day task "Notify the VAT office", open payment requests re-priced with VAT, ITA connection check.
5. Every alert, block and decision writes to `audit_log`.

Open: whether the crossing transaction itself carries VAT in full (A12).

## עוסק מורשה, from the confirmed switch

| Rule | Source | Open Ledger IL feature |
|---|---|---|
| Tax invoice for every taxable sale when the buyer asks, fields: "חשבונית מס", "עוסק מורשה" and VAT number, serial number, date, client name, description, amount before VAT, VAT, total | VAT regulations | New series for 305, 320, 330. Finalize validation |
| Service provider on cash basis: tax invoice within 14 days of payment | VAT law section 46(א), cash basis per section 29(2) and regulation 7 | Default flow: חשבון עסקה, then חשבונית מס/קבלה on payment. Task with a 14-day deadline, alert on day 10 |
| VAT 18% | VAT law, rate since 1.1.2025 | Rate table with effective dates, never hard-coded |
| 0% VAT for services to a foreign resident with no Israeli beneficiary | VAT law section 30(a)(5) | Client flag "foreign resident", document shows 0% and the client's country |
| Client ID or VAT number on tax invoices above ₪5,000 before VAT | VAT law amendment 37 | Required field above the limit |
| Allocation number on qualifying tax invoices above ₪5,000 before VAT | Israel Invoices regulation, since 1.6.2026 | ITA API integration. See `israel-invoices-api.md` |
| Input VAT only on supplier invoices with a valid allocation number above the threshold | Same | Buyer-side check on expenses |
| Periodic VAT report | VAT law | VAT summary report per period. CONFIRM monthly or bi-monthly, and PCN874 duty |
| Transition from פטור | SUMIT article 13616366 | Status change keyed to an effective date. Old series closed. Standing payment requests re-priced with VAT |

## Not bookkeeping documents

Quotes (הצעת מחיר) and payment requests (דרישת תשלום). Own numbered series, editable until converted, never counted as income.

Pro forma invoice (חשבון עסקה, code 300, R01, merged with PF's own behaviour in R18 task 10):
same rules as a payment request. Own numbered series, available in both legal modes, foreign
currency without ILS by default (the Show ILS option applies the same as any other document),
never a tax document and never eligible for an ITA allocation number whatever the amount.
Converts to a receipt or an invoice/receipt with its lines and agreed rate carried over. Prints
"This is not a tax invoice" / "אינו חשבונית מס" on every copy. Excluded from income reports and
the unified file (document_types.bookkeeping = 0), same as a quote or payment request.

`300` was originally a separate, bookkeeping "Transaction invoice": R18 task 10 folded that
identity into PF's, since the two were the same document in practice, on the reasoning that 300
already had the wider footprint (every create menu, the sidebar, existing conversions) so it kept
its own series and numbering rather than PF's. PF itself (R17 task 4) is disabled for new
documents (`document_types.enabled = 0`, migration 1803) but never edited or renumbered: an
already-finalized PF stays exactly as issued, forever (rule 1), still printing the same
disclaimer when reprinted.
