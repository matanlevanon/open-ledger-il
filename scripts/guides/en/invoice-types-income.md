---
title: "Pro forma, payment request and receipt: the difference, and what counts as income"
description: Pro forma, payment request, receipt and tax invoice in Israel. Which one is income, and why a report never counts a request and its receipt twice.
published: true
updated: 2026-10-14
sources:
  - {{repo}}/blob/main/docs/legal-requirements.md
  - {{repo}}/blob/main/docs/israel-invoices-api.md
faq:
  - q: Is a pro forma (חשבון עסקה) an invoice?
    a: No. It is a request for payment, and it prints "אינו חשבונית מס" (not a tax invoice).
  - q: Which document is recorded as income?
    a: The receipt, for an עוסק פטור. For an עוסק מורשה, the tax invoice or the tax invoice/receipt.
  - q: Does a pro forma need an allocation number?
    a: No, in normal use. Only when it serves as the advance approval the specification describes.
  - q: How soon after a payment do I issue a tax invoice?
    a: A service provider on a cash basis issues a tax invoice within 14 days of the payment.
  - q: Does a payment request go into the income report?
    a: No. Quotes and payment requests are not counted in income reports, since they are not bookkeeping documents.
---

A small business issues several kinds of documents, and each has a different job. Some ask for money, some record money received, and only some count as income. Mix them up and the reports go wrong: the same payment counted twice, or income not counted at all.

## Documents that ask for money

These go out before the client pays. They are not bookkeeping documents, and they do not count as income [1]:

- **Quote**: what the work will cost. It stays editable until it becomes another document [1].
- **Payment request**: a request to pay an amount [1].
- **Pro forma invoice (חשבון עסקה)**: the same job as a payment request. It prints "אינו חשבונית מס" (not a tax invoice) on every copy [1]. It is available to both an עוסק פטור and an עוסק מורשה [1].

Each has its own number series [1]. A plain pro forma never gets a Tax Authority allocation number, whatever the amount [2].

## Documents that record money received

- **Receipt**: records a payment received. A receipt is required for every payment, issued close to it [1]. For an עוסק פטור, the receipt is the income.
- **Tax invoice/receipt**: for an עוסק מורשה, one document that both charges VAT and records the payment [1].

## Tax invoice

A tax invoice belongs to an עוסק מורשה. It shows the words "חשבונית מס" and "עוסק מורשה" with the VAT number, a serial number, the date, the client name, a description, the amount before VAT, the VAT and the total [1]. A tax invoice above {{allocation_threshold}} before VAT to a client who is an עוסק מורשה needs an allocation number [2].

A service provider reporting on a cash basis issues a tax invoice within 14 days of receiving payment, under section 46(a) of the VAT law [1].

## What counts as income

The simple rule: **a document that asks for money is a charge, a document that records money is income** [1].

When a client gets a payment request and then pays, there are two documents: the request and the receipt. Only the receipt is income. A report that adds both shows double the truth [1].

To prevent that, the receipt should be created from the request and point back to it. Then you can see that the request is closed, and the money is counted once.

## The usual flow

**עוסק פטור:**

1. A quote, if needed.
2. A payment request or a pro forma.
3. A receipt when the money arrives.

**עוסק מורשה providing services on a cash basis** [1]:

1. A pro forma.
2. When the money arrives, a tax invoice/receipt, within 14 days of the payment.

A partial payment leaves the rest open on the request, and another receipt closes it.

## Foreign currency

A pro forma can be in a foreign currency, for example for a client abroad. By default it shows only the foreign currency, with no shekel amount [1]. When the client pays, the receipt or tax invoice/receipt made from it takes over its lines and the agreed rate [1].

The books themselves are kept in shekels. A bookkeeping document in a foreign currency shows the currency, the foreign amount and the shekel amount (instruction 22) [1]. So the rate matters: it sets the amount recorded as income.

## Corrections

None of these documents is edited once issued. A bookkeeping document is corrected by cancellation or credit (instruction 18) [1]. Quotes and payment requests are not bookkeeping documents, but they are numbered in their own series too [1].

## How Open Ledger IL does it

In Open Ledger IL, quotes, payment requests and pro formas are numbered in their own series and never counted in income reports. Recording a payment on a request issues a receipt linked to it, and a partial payment leaves the rest open. A pro forma prints "אינו חשבונית מס", and converting it to a receipt or a tax invoice/receipt carries over its lines and the agreed rate. For an עוסק מורשה, the app reminds you to issue the tax invoice within 14 days of the payment.
