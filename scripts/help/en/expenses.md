---
title: Get your expenses into the Ledger
description: Upload receipts and supplier invoices, let AI read them, and import a month from Google Drive. Plus the email inbox that is coming.
updated: 2026-10-17
published: true
order: 9
---

## Upload

The quickest way.

1. Open **Expenses** and click **Upload expense**.
2. Pick the file: PDF, JPG or PNG. On a phone, take a photo of the paper receipt.
3. With a Gemini or Anthropic key set, the Ledger reads the supplier, date, amounts and VAT, and fills them in. Check them and save.
4. Without a key, type the details yourself.

To add a reading key after the install, see [Add or change a key](/help/keys-later/).

## A month from Google Drive

For people who already keep receipts in Drive, one folder per month named `YYYY-MM`, for example `2026-10`.

1. Follow the Drive setup in the repository: a Google Cloud project, the Drive and Sheets APIs, a service account, and the expenses folder shared with that account as Editor. The guide is `docs/drive-expenses-setup.md` on GitHub.
2. Give the Ledger the service account's JSON key as the secret `GOOGLE_SERVICE_ACCOUNT_JSON`, see [Add or change a key](/help/keys-later/).
3. In **Settings > Expenses**, paste the folder id, the part of the folder's address after `/folders/`, and click **Save folder**.
4. In **Expenses**, pick the month and click **Import month**. Each file goes through AI reading and waits for your check. Running it twice adds nothing twice.
5. To import every morning, turn on **Daily sync** in **Settings > Expenses**.

## Coming: forward receipts by email

We are building a private email address for each Ledger. You set one rule in Gmail or Outlook that forwards receipts to it, and every receipt lands in **Expenses** read and waiting for your check. No Drive, no Google Cloud. This page will explain the setup once it ships.
