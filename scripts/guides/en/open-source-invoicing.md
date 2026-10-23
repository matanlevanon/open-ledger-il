---
title: "An open-source alternative to paid invoicing software: a plain comparison"
description: Subscription software, your accountant's system or open source. Three ways for a small Israeli business to keep its books, and what to check in each.
published: true
nav: "Open-source alternative"
order: 8
updated: 2026-10-14
sources:
  - {{repo}}/blob/main/docs/legal-requirements.md
  - https://www.gov.il/he/service/registration-software-designed-managing-computerized-accounting-system
  - https://www.gnu.org/licenses/agpl-3.0.html
  - {{repo}}/blob/main/docs/israel-invoices-api.md
  - {{repo}}/blob/main/docs/deploy.md
faq:
  - q: Does open source mean no warranty?
    a: The licence gives no warranty on the code. What you do get is the ability to read it and check it yourself.
  - q: Must open-source software be registered with the Tax Authority too?
    a: If others use it, yes. The duty includes software offered for free use.
  - q: What matters most before choosing?
    a: That your books stay yours, that you can export them in the Tax Authority format, and that the software is registered when it needs to be.
  - q: Can I get help installing open-source software?
    a: Yes. There is a step-by-step deploy guide, and you can also ask someone to set the system up for you.
---

A small business in Israel has to issue documents by the law and keep them for years. There are several ways to do it, each with its benefits and trade-offs. This guide compares three approaches, not products: subscription software, the accountant's system, and open source running in your own account.

## What every system must do

Before the comparison, these requirements apply whichever way you choose [1]:

- **A receipt for every payment**, close to the payment.
- **A continuous number series** per document type, with no gaps and no deletion.
- **Corrections by cancellation or credit**, not by editing.
- **Retention for 7 years** from the end of the tax year, or 6 years from filing the return, whichever is later.
- **A quarterly backup** kept away from the system.
- **Allocation numbers** on tax invoices above the threshold, for an עוסק מורשה [4].
- **Registered software**, when it serves others [2].

Each of the three approaches can meet them. The difference is who does the work, and who holds the data.

## Approach 1: subscription software

A company runs the software on its servers, you sign in through the browser and pay every month or year.

**What you get:** nothing to install. The company updates, backs up and maintains it. There is usually support.

**What to think about:**

- The data sits with the company. Check how you export it, and in what format.
- Payment continues for as long as you use it, including years when you only need to keep old books.
- Check that the software is registered with the Tax Authority and asks for allocation numbers, if you are an עוסק מורשה.

## Approach 2: the accountant's system

Some accountants issue documents for the client, or give the client access to their own system.

**What you get:** someone who knows the rules holds the books. Less work for you.

**What to think about:**

- The data is tied to the accountant. Ask what happens if you change accountants.
- Every document passes through someone else, which can slow things down.
- Check whether you can get a full export, for example a unified file (מבנה אחיד).

## Approach 3: open source in your own account

The software comes with its source code, and you run it in a cloud account or on a computer of your own.

**What you get:** your data sits with you. No licence fee. You can read the code and check how each rule is built. Under a licence such as the AGPL-3.0, anyone may use, change and share it, and whoever runs a changed version for others over a network offers them its source code [3].

**What to think about:**

- **Installing is yours**, or the job of whoever sets it up for you [5].
- **Updates and backups are yours.** Pick software that backs itself up.
- **No warranty.** The licence gives no warranty on the code [3].
- **Registration.** Running it for your own business needs no registration. Running it for other businesses does [1]. If someone gives you the software to use, check that it is registered [2].

## How to choose

A few questions help you decide:

1. **Who should hold the data?** If you want the books in an account in your own name, the third approach fits.
2. **How much time do you want to spend?** If you never want to touch an install, choose a subscription, your accountant, or a set-up service.
3. **What happens the day you leave?** In every approach, make sure you can take the books, in a format the Tax Authority and another accountant can read.
4. **Does the software meet the requirements?** Go through the list above for each option.

## How Open Ledger IL does it

Open Ledger IL is close to the third approach: the source is public under the FSL-1.1 licence, free for your own business, and runs in your own Cloudflare account. Each version becomes Apache 2.0 open source two years after release. It is registered with the Tax Authority, certificate 281801. It locks final documents, numbers them without gaps, asks for allocation numbers, backs up every quarter and produces a unified file. Run it free from source with the deploy guide, install it yourself with the ₪99 connected installer, or have it set up for you.
