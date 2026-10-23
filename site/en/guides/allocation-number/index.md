# Allocation numbers: what they are, when you need one, and how to get one automatically

When an Israeli tax invoice needs an allocation number from the Tax Authority, what happens without one, and how connected software asks for it.

Updated 2026-10-14

An allocation number (מספר הקצאה) is a number the Israel Tax Authority gives a specific tax invoice before it goes to the client. It is printed on the invoice, and the client needs it to deduct the input VAT on that invoice. The scheme is called Israel Invoices (חשבוניות ישראל) [1].

This guide covers when the number is required, what happens without it, and how connected software asks for it without you visiting the Tax Authority site.

## When an allocation number is required

An invoice needs an allocation number when four conditions hold together [2]:

1. The document is a tax invoice: a tax invoice, a tax invoice/receipt, and in some cases the other types the specification lists.
2. The amount before VAT is above ₪5,000. That threshold applies from 1 June 2026 [1]. It came down in steps during 2026 [2].
3. The VAT amount on the invoice is above zero.
4. The client is an Israeli עוסק מורשה, or the client asked for a number.

The threshold applies to each invoice, not to a monthly total. A monthly retainer billed on one invoice above the threshold needs a number every month. Five invoices that are each above the threshold need five numbers [2].

## What needs no number

- An invoice to a client abroad at 0% VAT under section 30(a)(5) of the VAT law. It has no VAT amount, and the client has no Israeli VAT number [2].
- A plain pro forma invoice (חשבון עסקה) and a credit invoice [2].
- Anything issued while you are an עוסק פטור [2].

A voluntary request is allowed for any amount. For a client who does not deduct input VAT, you send the customer number 999999998, per the Tax Authority's questions and answers [2].

## What happens without a number

On the buyer's side, a supplier invoice above the threshold without a valid allocation number gives no input VAT deduction [3]. So a business client will ask for the number, and software that issues tax invoices needs to ask for it.

On the seller's side, when the Tax Authority refuses a number, there are four choices [2]:

1. Cancel the invoice with a standard cancellation, and tell the Tax Authority.
2. Continue without a number. The invoice prints the bold line "אין לנכות מס תשומות בגין חשבונית זו" (no input VAT may be deducted on this invoice).
3. Reverse charge, with the client's agreement: a new invoice with 0% VAT, and the client reports a self-invoice.
4. Ask for a hearing. After a decision in your favour, ask again for the same invoice.

## How you get the number

### By hand, on the Tax Authority site

A web app on the Tax Authority site serves עוסקים מורשים who use an invoice book or software that is not connected [4]. You enter the client's VAT number, the invoice number, the amount before VAT and the VAT amount. One invoice at a time, and a number you get there cannot be cancelled [2].

### Automatically, from your software

Connected software asks for the number through the Tax Authority API as it issues the invoice [2]. The business owner signs in once with their user code and one-time code, and signs in again about every three months. In between, the connection renews itself [2].

The steps in such software [2]:

1. The draft passes its checks.
2. The invoice gets the next number in its series.
3. The software sends a request with the invoice details.
4. When a number comes back, it is stored, and the invoice is signed and sent.
5. When the Tax Authority does not answer, the request waits in a queue and is sent again. A manual request remains a fallback.

A business that builds software for its own use can register as a software house with an ID number and open an app on the Tax Authority developer portal [2]. Production access needs approval from Tax Authority customer service, with no published timeline [2]. Start early.

## How Open Ledger IL does it

Open Ledger IL asks for the allocation number as it issues the invoice, through the Tax Authority API. The invoice PDF never goes out before a number or a recorded decision, a rule enforced in the code. When the Tax Authority does not answer, the request waits in a queue and retries every 15 minutes, and a field takes a number you got on the Tax Authority site. After a refusal, the app shows the four choices and prints the right notice.

The threshold, document types and dates live in a table with effective dates, so a change in the law needs no change in the code.

[Try the live demo](https://demo.open-ledger.dev) [See pricing and setup](https://open-ledger.dev/en/pricing/)

## Questions and answers

**Does an עוסק פטור need allocation numbers?**

No. An עוסק פטור issues no tax invoices, so nothing it issues falls under the rule.

**Is the threshold per invoice or per month?**

Per invoice. Every invoice above the threshold needs its own number, even when one client gets several invoices in a month.

**What if the Tax Authority refuses to give a number?**

You have four choices. Cancel the invoice, continue without a number with a bold notice, switch to reverse charge with the client's agreement, or ask for a hearing.

**Can I ask for a number on a small invoice?**

Yes. A voluntary request is allowed for any amount.

## Sources

1. [https://www.gov.il/he/service/request-assignment-number-for-tax-invoice](https://www.gov.il/he/service/request-assignment-number-for-tax-invoice)
2. [https://github.com/matanlevanon/open-ledger-il/blob/main/docs/israel-invoices-api.md](https://github.com/matanlevanon/open-ledger-il/blob/main/docs/israel-invoices-api.md)
3. [https://github.com/matanlevanon/open-ledger-il/blob/main/docs/legal-requirements.md](https://github.com/matanlevanon/open-ledger-il/blob/main/docs/legal-requirements.md)
4. [https://secapp.taxes.gov.il/em-hkz-hsb-intr](https://secapp.taxes.gov.il/em-hkz-hsb-intr)

## More guides

- [Invoices for an עוסק פטור: which documents you may issue and what they say](https://open-ledger.dev/en/guides/osek-patur-invoice/)
- [The עוסק פטור ceiling: how to track it and what happens when you cross it](https://open-ledger.dev/en/guides/osek-patur-ceiling/)
- [Pro forma, payment request and receipt: the difference, and what counts as income](https://open-ledger.dev/en/guides/invoice-types-income/)
- [Software registered with the Tax Authority: what it means and how to check](https://open-ledger.dev/en/guides/registered-software/)
- [The unified file (מבנה אחיד): what it is and when your accountant needs it](https://open-ledger.dev/en/guides/unified-file/)
- [Israeli invoicing software prices compared (2026)](https://open-ledger.dev/en/guides/invoicing-software-prices/)
- [An open-source alternative to paid invoicing software: a plain comparison](https://open-ledger.dev/en/guides/open-source-invoicing/)
- [Bookkeeping on your own cloud: what Cloudflare is, and why it costs little](https://open-ledger.dev/en/guides/own-cloud-bookkeeping/)

Source: https://open-ledger.dev/en/guides/allocation-number/
