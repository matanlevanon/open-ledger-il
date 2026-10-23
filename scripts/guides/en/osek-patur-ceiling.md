---
title: "The עוסק פטור ceiling: how to track it and what happens when you cross it"
description: What the עוסק פטור turnover ceiling is, how to track it through the year, and what happens the day your turnover goes past it.
published: false
updated: 2026-10-14
sources:
  - {{repo}}/blob/main/docs/legal-requirements.md
  - https://www.btl.gov.il/Laws1/02_0022_100001.pdf
  - https://he.wikisource.org/wiki/%D7%97%D7%95%D7%A7_%D7%9E%D7%A1_%D7%A2%D7%A8%D7%9A_%D7%9E%D7%95%D7%A1%D7%A3
  - https://he.wikisource.org/wiki/%D7%AA%D7%A7%D7%A0%D7%95%D7%AA_%D7%9E%D7%A1_%D7%A2%D7%A8%D7%9A_%D7%9E%D7%95%D7%A1%D7%A3_%28%D7%A8%D7%99%D7%A9%D7%95%D7%9D%29
faq:
  - q: What is the ceiling this year?
    a: "{{patur_ceiling}} for {{patur_ceiling_year}}. The ceiling is updated every year."
  - q: Do I become מורשה on 1 January?
    a: No. The switch happens when turnover goes past the ceiling, not on a fixed date.
  - q: Is the test based on money received?
    a: Not only. The test looks at expected turnover, not only money already received.
  - q: How soon do I tell the VAT office?
    a: Within 15 days of the event, under regulation 8(a) of the VAT registration regulations, as secondary sources summarise it.
  - q: What is the VAT rate after the switch?
    a: "{{vat_rate}}, the rate in force from {{vat_rate_from}}."
---

An עוסק פטור is a business whose annual turnover stays under a ceiling set by law. The ceiling for {{patur_ceiling_year}} is {{patur_ceiling}} [1]. It is updated every year in line with the index, and next year's figure is usually published around January [1].

This guide covers how to track turnover through the year, and what happens the day it goes past the ceiling.

## What counts as turnover

Turnover is the total of your transactions, not your profit. Section 1 of the VAT Law sets the ceiling as turnover per year [3]. The VAT registration regulations say how to measure it: a running business looks at the past tax year, and a new business uses its estimate for the coming year, as if it worked the whole year [4].

So adding up receipts is not enough. A payment request that is still open is money you expect, and it belongs in the picture now.

## How to track it through the year

Good tracking rests on three figures:

1. **Turnover to date**: the total of receipts since the start of the year.
2. **Open requests**: payment requests and pro formas issued and not yet paid.
3. **This year's ceiling**: the amount the law sets for the current year.

Add the first two and compare them with the third, and you see how much room is left. Set alerts before you reach the edge, for example at 70, 85 and 95 percent of the ceiling [1].

The ceiling itself changes every year. A system that keeps the ceiling in a table, one row per year, needs no code change when the figure is updated [1].

## What happens when you cross it

As secondary sources summarise it [1]:

- **The switch is neither automatic nor on a fixed date.** It happens when turnover goes past the ceiling.
- **VAT applies from the moment you cross.** Earlier transactions stay exempt.
- **You tell the VAT office within 15 days of the event**, under regulation 8(a) of the VAT (registration) regulations [2].

The law and the regulations do not say whether the transaction that crosses the ceiling carries VAT in full, or only the part above it. Ask your accountant before you issue that document. Section 63 of the VAT Law sets when a change of classification takes effect: 30 days after the month in which you gave notice, or another date the director sets [3].

After the switch, the business issues tax invoices, charges VAT and files VAT reports. Open payment requests issued before the switch are re-priced with VAT [1].

## What to do before you get there

- **Look early.** When the room left is small, plan the timing of the switch with your accountant.
- **Watch open requests.** One large transaction can take you past the ceiling.
- **Get ready for tax invoices.** After the switch, a tax invoice above the threshold needs an allocation number from the Tax Authority [1]. Setting up that connection takes time.

## What changes the day after

An עוסק מורשה works by other rules. Know them before you reach the ceiling [1]:

- **VAT**: the rate is {{vat_rate}}, from {{vat_rate_from}} [1].
- **A tax invoice within 14 days**: a service provider reporting on a cash basis issues a tax invoice within 14 days of receiving payment [1].
- **Client details**: a tax invoice above a set amount before VAT needs the client's ID or VAT number [1].
- **A periodic VAT report**: monthly or bi-monthly. Check with your accountant which applies to you [1].

## The switch goes one way

An עוסק פטור that becomes מורשה does not go back through the system. The פטור document series close, and new series open for tax invoices, tax invoice/receipts and credit invoices [1].

## How Open Ledger IL does it

Open Ledger IL shows a ceiling meter on the dashboard: turnover to date plus open requests, against this year's ceiling. Alerts go out at 70, 85 and 95 percent, and when turnover plus open requests passes the ceiling. A receipt that would take turnover past the ceiling stops before it is issued, and the screen offers to confirm the switch with an effective date, to issue as פטור while you stay at or under the ceiling, or to cancel. After the switch, a 15-day task reminds you to tell the VAT office, and open payment requests are re-priced with VAT. Every alert and decision is logged.
