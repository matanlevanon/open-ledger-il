---
title: "Israeli invoicing software prices compared (2026)"
description: What Morning, iCount, SUMIT, EZcount, Invoice4U and Rivhit cost a year, which plan opens the API, and how a free or one-time option compares.
published: false
updated: 2026-10-23
sources:
  - https://www.greeninvoice.co.il/pricing/
  - https://www.icount.co.il/plans/
  - https://www.sumit.co.il/pricing
  - https://hyp.co.il/digital-invoice-pricing/
  - https://www.invoice4u.co.il/pricelist-invoice/
  - https://invoiceonline.co.il/%D7%9E%D7%97%D7%99%D7%A8%D7%95%D7%9F/
  - https://www.gov.il/he/service/registration-software-designed-managing-computerized-accounting-system
faq:
  - q: How hard is it to move from my current invoicing software?
    a: Four steps. Upload the client list as a CSV, upload the PDFs of past documents so AI reads and files them, set each series to continue from your last number, and keep the old system's unified file for 7 years.
  - q: Is there a free invoicing option in Israel?
    a: SUMIT has a free plan with 10 actions a month. Open Ledger IL is free from source, with no document limit, and runs in your own Cloudflare account.
  - q: Which plans include an API?
    a: Morning from the Best plan, iCount from Advanced, SUMIT from Start, and Rivhit as an add-on for ₪199 a month. Open Ledger IL includes it in every option.
  - q: Are these prices with VAT?
    a: No. All prices are before VAT, as each vendor published them on 23 October 2026. An עוסק פטור cannot reclaim VAT, so for a פטור business the real cost is 18% higher.
  - q: Does any plan cost less for an עוסק פטור?
    a: None of the vendors splits its plans by עוסק פטור and עוסק מורשה. The cheapest plan of each one issues both receipts and tax invoices.
---

Paid invoicing software in Israel is sold by subscription. The entry plans are cheap, the plans most businesses grow into cost more, and the payment repeats every year. This guide lays out what each of the main vendors charges, which plan opens the API, and what the bill looks like over five years.

All prices below are before VAT, checked on each vendor's pricing page on 23 October 2026 [1] [2] [3] [4] [5] [6]. Prices change, so check the vendor's page before you buy.

## The entry plans

| Software | Cheapest plan | Per year | Documents | API |
| --- | --- | --- | --- | --- |
| Morning (Green Invoice) | Basic | ₪348, billed yearly | 20 a month, then ₪1 each | From Best, ₪540 a year |
| iCount | Express | ₪276 | Unlimited | From Advanced, from ₪32 a month |
| SUMIT | Free | ₪0 | 10 actions a month | From Start, ₪228 a year |
| EZcount (Hyp) | Givol | ₪252, billed yearly | 50 a month | Listed, price not published |
| Invoice4U | Pink | ₪252, billed yearly | 50 a month | Listed, price not published |
| Rivhit, חשבונית אונליין | Basic | ₪288, billed yearly | 50 a month | ₪199 a month |
| Open Ledger IL | Free from source | ₪0 | No document limit | Included |
| Open Ledger IL | Connected installer | ₪99, once | No document limit | Included |

Monthly billing costs more than yearly billing at every vendor that offers both. Morning's Basic plan shows a yearly price only.

## The plans most businesses grow into

A business that sends more than a few dozen documents a month moves up a tier. These are the mid-tier plans, billed yearly:

- **Morning Best:** ₪540 a year, 50 documents a month, with the API, webhooks and card clearing [1].
- **iCount Advanced:** from ₪59 a month for 100 documents, with the API [2].
- **EZcount Shtil:** ₪348 a year, 100 documents a month [4].
- **Invoice4U Green:** ₪372 a year, 100 documents a month [5].
- **Rivhit, mid tier:** ₪348 a year, 100 documents a month [6].

So a mid-tier plan costs about ₪350 to ₪900 a year before VAT, every year you use it.

## Five years of the same plan

The yearly price repeats. Five years at today's prices, before VAT:

- Morning Basic: ₪1,740. Morning Best: ₪2,700.
- iCount Express: ₪1,380.
- EZcount Givol or Invoice4U Pink: ₪1,260.
- Open Ledger IL with the connected installer: ₪99, once.

Open Ledger IL runs on Cloudflare's free plans. A business that outgrows them moves to Workers Paid, from $5 a month, paid to Cloudflare. That is optional, and most small businesses do not need it.

## What every option has in common

- **Every document type.** Each plan above issues receipts for an עוסק פטור and tax invoices for an עוסק מורשה. None of the vendors splits its plans by the two.
- **Tax Authority registration.** The vendors publish their registration certificates. Check them yourself in the Tax Authority registry, as the guide on [registered software](/en/guides/registered-software/) explains.
- **The unified file.** Registered software must include a module that produces the unified file (מבנה אחיד) [7], so any registered system can export your books for an accountant or an audit.

## Where the books live

With subscription software, your documents sit on the vendor's servers, and getting them out depends on the vendor's export. With Open Ledger IL, the database and the PDFs sit in your own Cloudflare account. You can open the tables, download a backup, and keep the books for the 7 years the law requires without a subscription.

## When a subscription is the better choice

A subscription fits when you want phone support, card clearing in the same tool, or an accountant who already works in that system. It also fits if you do not want a Cloudflare account of your own. Open Ledger IL fits when you want the books in your own account, no yearly fee, and an API without paying for a higher tier.

## Moving from your current software

Switching does not mean starting over. The move takes four steps, and the old software can stay open until you finish:

1. **Bring your clients.** Export the client list from your current software as a CSV file. In **Import**, upload it and match its columns to the Ledger's fields. Any system that exports a CSV works.
2. **Bring your past documents.** Download the PDFs of the receipts and invoices you issued, and upload them in **Import**, many at a time. AI reads each one: type, number, date, client and amount. You check the fields and file them. They keep their original PDF and number, stay outside the Ledger's own number series, and count in each client's balance.
3. **Continue the numbering.** Set the starting number of each document series to the next number after your last document in the old software, so the series has no gap and no repeat.
4. **Keep the old books.** Before you close the old account, download its unified file (מבנה אחיד) and the PDFs, and keep them. The law asks you to keep books for 7 years, including the years before the move.

Expenses start fresh in the Ledger: forward receipts by email or upload them, and each one is read for you. Reading past documents and expenses needs a Gemini or Anthropic API key. Without one, you type the fields by hand. With the ₪699 setup, we do the move with you.

## How Open Ledger IL compares

Open Ledger IL is registered with the Tax Authority, certificate 281801. It issues every document type, asks for allocation numbers, and produces the unified file. Run it free from source, install it yourself with the ₪99 connected installer, or have it set up for you for ₪699, once. See the [pricing page](/en/pricing/).
