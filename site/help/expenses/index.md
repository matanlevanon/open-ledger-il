# Get your expenses into the Ledger

Upload receipts and supplier invoices, let AI read them, and import a month from Google Drive. Plus the email inbox that is coming.

Updated 2026-10-17

## Upload

The quickest way.

1. Open **Expenses** and click **Upload expense**.
2. Pick the file: PDF, JPG or PNG. On a phone, take a photo of the paper receipt.
3. With a Gemini or Anthropic key set, the Ledger reads the supplier, date, amounts and VAT, and fills them in. Check them and save.
4. Without a key, type the details yourself.

To add a reading key after the install, see [Add or change a key](https://open-ledger.matanlevanon.com/help/keys-later/).

## A month from Google Drive

For people who already keep receipts in Drive, one folder per month named `YYYY-MM`, for example `2026-10`.

1. Follow the Drive setup in the repository: a Google Cloud project, the Drive and Sheets APIs, a service account, and the expenses folder shared with that account as Editor. The guide is `docs/drive-expenses-setup.md` on GitHub.
2. Give the Ledger the service account's JSON key as the secret `GOOGLE_SERVICE_ACCOUNT_JSON`, see [Add or change a key](https://open-ledger.matanlevanon.com/help/keys-later/).
3. In **Settings > Expenses**, paste the folder id, the part of the folder's address after `/folders/`, and click **Save folder**.
4. In **Expenses**, pick the month and click **Import month**. Each file goes through AI reading and waits for your check. Running it twice adds nothing twice.
5. To import every morning, turn on **Daily sync** in **Settings > Expenses**.

## Coming: forward receipts by email

We are building a private email address for each Ledger. You set one rule in Gmail or Outlook that forwards receipts to it, and every receipt lands in **Expenses** read and waiting for your check. No Drive, no Google Cloud. This page will explain the setup once it ships.

Still stuck? [Write to us from the pricing page.](https://open-ledger.matanlevanon.com/pricing/#setup)

## More help

- [Before you install: what you need](https://open-ledger.matanlevanon.com/help/before-you-start/)
- [Install Open Ledger IL step by step](https://open-ledger.matanlevanon.com/help/install/)
- [Create the Cloudflare API token](https://open-ledger.matanlevanon.com/help/cloudflare-token/)
- [First sign-in and setup](https://open-ledger.matanlevanon.com/help/first-sign-in/)
- [Give your accountant or assistant access](https://open-ledger.matanlevanon.com/help/users/)
- [Connect to the Tax Authority for allocation numbers](https://open-ledger.matanlevanon.com/help/tax-authority/)
- [From quote to receipt: your first documents](https://open-ledger.matanlevanon.com/help/first-invoice/)
- [Take payments with Grow, Cardcom or another provider](https://open-ledger.matanlevanon.com/help/payment-providers/)
- [Send documents by email, and keep them out of spam](https://open-ledger.matanlevanon.com/help/email/)
- [Connect Claude or another AI app (MCP)](https://open-ledger.matanlevanon.com/help/connect-claude/)
- [Add or change a key after the install](https://open-ledger.matanlevanon.com/help/keys-later/)
- [Updates and backups](https://open-ledger.matanlevanon.com/help/updates-backups/)
- [Common problems and how to fix them](https://open-ledger.matanlevanon.com/help/troubleshooting/)

Source: https://open-ledger.matanlevanon.com/help/expenses/
