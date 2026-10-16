---
title: Before you install: what you need
description: The accounts, details and 30 minutes you need before you run the Open Ledger IL installer, and which parts are optional.
updated: 2026-10-17
published: true
nav: Before you install
order: 1
---

The install takes about 30 minutes the first time. Most of that is creating accounts. Have these ready before you start.

## Required

- **A Windows computer.** The installer runs on Windows 10 or 11. After the install, the Ledger opens in any browser, on any computer or phone.
- **The licence key** from your purchase email. It looks like `OL-XXXX-XXXX-XXXX-XXXX`. One key is one business.
- **The business details:** the business name as it should appear on documents, the owner's email, and the 9-digit tax number (ת"ז for a sole trader, ח.פ. for a company). The key works for this tax number only.
- **An email address you read.** It becomes the owner's sign-in. Cloudflare sends a one-time code to it each time you sign in.
- **A credit card.** Cloudflare asks for one to turn on two free services, Zero Trust and R2. The free plans cost $0 and nothing is charged.

## Optional

You add each of these during the install or later.

- **A domain**, for example acme.co.il, already in your Cloudflare account. Without one, the Ledger runs on a free Cloudflare address ending in workers.dev. See [Domain or workers.dev](/help/install/).
- **A Gemini or Anthropic API key**, so the Ledger reads receipts and supplier invoices for you. Without one, you type expense details by hand.
- **A Resend API key**, so the Ledger emails documents to clients. Resend needs a domain. Without one, you download each PDF or share it on WhatsApp.
- **A Slack webhook**, for alerts such as a Tax Authority login about to end.

## Who owns what

Everything is created in your own accounts, in your name: the Cloudflare account, the database, the files. MTN does not hold your data. The only link to MTN is the Tax Authority connection in the connected edition, which passes your allocation-number requests through MTN's approved app.

## Next

[Install with the installer](/help/install/).
