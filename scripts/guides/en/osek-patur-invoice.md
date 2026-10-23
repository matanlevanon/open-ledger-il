---
title: "Invoices for an עוסק פטור: which documents you may issue and what they say"
description: An עוסק פטור issues no tax invoices. Which documents it does issue, what they must show, and how to number, correct and send them digitally.
published: true
nav: "Invoices for an עוסק פטור"
order: 1
updated: 2026-10-14
sources:
  - {{repo}}/blob/main/docs/legal-requirements.md
  - https://www.gov.il/he/service/registration-software-designed-managing-computerized-accounting-system
  - {{repo}}/blob/main/docs/israel-invoices-api.md
  - https://he.wikisource.org/wiki/%D7%94%D7%95%D7%A8%D7%90%D7%95%D7%AA_%D7%9E%D7%A1_%D7%94%D7%9B%D7%A0%D7%A1%D7%94_%28%D7%A0%D7%99%D7%94%D7%95%D7%9C_%D7%A4%D7%A0%D7%A7%D7%A1%D7%99_%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA%29
faq:
  - q: Can an עוסק פטור issue a tax invoice?
    a: No. An עוסק פטור charges no VAT and issues no tax invoices. The document that records a payment is a receipt.
  - q: What is the difference between a payment request and a receipt?
    a: A payment request asks for money and is not a bookkeeping document. A receipt records money received, and it is the income.
  - q: Can I send a receipt by email?
    a: Yes, with conditions. You need the client's consent, a secured electronic signature on the file, and a notice to the assessing officer before the first digital document.
  - q: What do I do when a receipt has a mistake?
    a: You do not edit it. You cancel it or issue a credit document, and the original is kept.
---

An עוסק פטור is a business whose annual turnover is under the ceiling. It charges its clients no VAT, so it issues no tax invoices either [1]. The question "which invoice does an עוסק פטור issue" turns into another one: which documents may it issue, and what must they say.

## The documents an עוסק פטור issues

Under the bookkeeping instructions and the VAT law, these are the documents an עוסק פטור works with [1]:

- **Receipt.** Records money received. A receipt is required for every payment, issued close to the payment [1]. This is the document that counts as income.
- **Credit receipt.** Corrects a receipt already issued, when money goes back or there was a mistake.
- **Pro forma invoice (חשבון עסקה).** Asks for payment before it arrives. It prints "אינו חשבונית מס" (not a tax invoice) and is not income [1].
- **Payment request.** Like a pro forma: it asks for money and is not a bookkeeping document [1].
- **Quote.** Not a bookkeeping document. It stays editable until it becomes another document [1].

Tax invoices, tax invoice/receipts and credit invoices belong to an עוסק מורשה. When an עוסק פטור becomes מורשה, the פטור series close and new ones open [1].

## What a receipt from an עוסק פטור shows

The documents of an עוסק פטור carry the words "עוסק פטור" and the ID number [1]. Section 5(a) of the bookkeeping instructions lists what a receipt shows [4]: a sequential number, the business name and its ID or dealer number, the date, the payer's name and address, the amount received, what the payment is for, and the signature of the person who received it, unless the receipt is sent as a computerized document. The payer's name and address can be left out on a retail cash sale, and the address when you do not know it. For a cheque, add its number, bank, branch and due date [4].

A few rules apply to every document [1]:

- **Language.** Records are kept in Hebrew or Arabic (instruction 21). English can sit next to the Hebrew.
- **Currency.** Amounts are recorded in shekels. A document in a foreign currency also shows the currency and the foreign amount (instruction 22).
- **Original and copy.** The original is issued once. Every other copy is marked as a copy.

## Numbering: one series, no gaps

Each document type has one continuous number series. No gaps, and no deleting a document once issued [1]. A draft has no number, so a deleted draft leaves no gap. The number is given only at the moment of issue.

## Correcting a mistake

An issued document is never edited. A mistake is fixed in one of two ways (instruction 18) [1]:

- **Cancellation**, for a document not sent yet. It is marked "בוטל" (cancelled), and a copy is kept.
- **Credit**, a new document that offsets the original, in full or in part.

## Sending digitally

You may send a receipt as a file, with conditions (instruction 18ב) [1]:

1. A notice to the assessing officer by registered mail, before the first digital document.
2. The client's consent to receive digital documents.
3. A secured electronic signature on the file.

## Keeping and backing up

Documents are kept 7 years from the end of the tax year, or 6 years from filing the return, whichever is later (instruction 25) [1]. A computerized system backs up its data every quarter, in the first week of the quarter, and keeps the backup away from the system [1].

## Allocation numbers

An עוסק פטור needs no allocation numbers. Everything issued while the business is פטור falls outside the rule [3].

## Registered software

An עוסק פטור who uses software that someone else sells, rents out or lets others use needs software registered with the Tax Authority. The producer registers it [2]. A business that writes software and runs it for itself only needs no registration [1].

## How Open Ledger IL does it

In עוסק פטור mode, Open Ledger IL offers only the documents allowed: receipt, credit receipt, pro forma, payment request and quote. "עוסק פטור" and the ID number print in the header. Recording a payment issues the receipt in the same step. Numbers are given at issue, database triggers block edits to a final document, and every PDF carries a digital signature. Sending by email stays blocked until the client has consented.
