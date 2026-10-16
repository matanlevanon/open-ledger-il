---
title: Get your expenses into the Ledger
description: Forward receipts by email, upload them, or import a month from Google Drive. Each one is read by AI and waits for your check.
updated: 2026-10-17
published: true
nav: Expenses
order: 9
---

## Forward receipts by email

The easiest way for receipts that reach your inbox. Your Ledger has a private address. Everything forwarded there becomes an expense, read by AI and waiting for your check.

### Find your address

Open **Settings > Expenses > Email inbox**. The address looks like `expenses+r7k2m9x4qp@open-ledger.dev`. Click **Copy**. The installer sets it up. If the page says the inbox is not set up, run the installer again.

### Set it up in Gmail, once

1. In Gmail, click the gear, then **See all settings**, then the tab **Forwarding and POP/IMAP**.
2. Click **Add a forwarding address**, paste the address and confirm.
3. Gmail sends a confirmation code to that address. It shows up in the Ledger under **Email inbox**: "Gmail sent a confirmation code". Type the code in Gmail and click **Verify**.
4. Leave **Disable forwarding** selected. You forward only receipts, not all your mail.
5. In the Gmail search box, paste the search from the Ledger page, for example `has:attachment (invoice OR receipt OR חשבונית OR קבלה)`. Add your suppliers if you like: `from:(billing@supplier.com)`.
6. Click the search options icon, then **Create filter**. Tick **Forward it to**, pick the address, and click **Create filter**.

From now on, every matching email goes to the Ledger by itself. To send one by hand, forward it to the same address.

### Outlook

**Settings > Mail > Rules > Add new rule.** Condition: **Has attachment**, and words in the subject such as invoice or receipt. Action: **Forward to** the address.

### What happens to each email

- Each PDF, JPG, PNG, WebP or HEIC attachment becomes one expense. Small logo images are skipped.
- An email with no attachment becomes one expense from its text, marked "From email text, check the amount".
- The same file twice is one expense.
- Only email forwarded from your own addresses counts. The list is under **Allowed senders**, and starts with the owner and assistant emails. Anything else is ignored and listed under **Last received**.
- The address passes through MTN's email gateway, which stores nothing. With your own domain on Cloudflare, you route an address such as `receipts@your-domain.co.il` straight to your Ledger instead. The repository's `docs/expense-inbox.md` explains how.

### A new address

If the address leaks or gets spam, click **Make a new address**. The old one stops at once. Update the Gmail filter with the new one.

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
