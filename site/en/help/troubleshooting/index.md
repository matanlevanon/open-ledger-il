# Common problems and how to fix them

Fixes for the places people get stuck: Windows warnings, the Cloudflare token, Zero Trust, keys the installer refuses, sign-in, downloads and email.

Updated 2026-10-17

## The installer

- **Windows protected your PC.** Click **More info**, then **Run anyway**.
- **The antivirus removed the file.** Restore it from the antivirus quarantine and allow it, or download it again from the purchase email.
- **Nothing opens after double-click.** Wait 20 seconds, the file is large. The installer opens a browser tab at an address starting with `http://127.0.0.1`. If no tab opens, copy that address from the small black window into your browser.
- **The licence key is refused.** Type it as `OL-XXXX-XXXX-XXXX-XXXX`, and check the tax number. The key works only for the tax number it was bought for. Reinstalling the same business with the same key is fine.

## Cloudflare

- **Zone Resources is missing.** It shows up only after a Zone permission row. Without a domain, skip it and use the free workers.dev address. See [Create the Cloudflare API token](https://open-ledger.dev/en/help/cloudflare-token/).
- **Check token fails.** The message names the missing permission. Edit the token, add the row, save, and check again.
- **Zero Trust or R2 asks for a card.** Both free plans ask for a payment method and charge nothing.
- **Purchase R2 Plan.** Click it and confirm the free tier. The first 10 GB a month are free.

## Keys

- **A Gemini key is refused.** New keys from Google AI Studio start with `AQ.`. The installer from version 1.6.0 of 17 October 2026 accepts them. With an older installer, pick **No** for expense reading and add the key afterwards, see [Add or change a key](https://open-ledger.dev/en/help/keys-later/).
- **An Anthropic key is refused.** It starts with `sk-ant-`. Copy it again from console.anthropic.com.

## Signing in

- **A Cloudflare page asks for an email.** That is the sign-in. Type the owner email and paste the code from the email.
- **No code arrives.** Check spam, and check that the email is the one given in the installer.
- **Someone else is stopped at the Cloudflare page.** Add their email in Cloudflare Access, see [Give your accountant access](https://open-ledger.dev/en/help/users/).

## Downloads and email

- **The download link says it expired or ran out.** Click **Email me a fresh link** on that page.
- **Clients get your documents in spam.** See [Keep them out of spam](https://open-ledger.dev/en/help/email/).
- **Lost the MCP token.** See [Connect Claude](https://open-ledger.dev/en/help/connect-claude/).

## Tax Authority

- **ITA says reconnect.** The login lasts 90 days. Open **ITA** and click **Connect again**.
- **An invoice waits for a number for 24 hours.** Request the number in the Tax Authority web app and type it on the ITA page.

Still stuck? [Write to us from the pricing page.](https://open-ledger.dev/en/pricing/#setup)

## More help

- [Before you install: what you need](https://open-ledger.dev/en/help/before-you-start/)
- [Install Open Ledger IL step by step](https://open-ledger.dev/en/help/install/)
- [Create the Cloudflare API token](https://open-ledger.dev/en/help/cloudflare-token/)
- [First sign-in and setup](https://open-ledger.dev/en/help/first-sign-in/)
- [Give your accountant or assistant access](https://open-ledger.dev/en/help/users/)
- [Connect to the Tax Authority for allocation numbers](https://open-ledger.dev/en/help/tax-authority/)
- [From quote to receipt: your first documents](https://open-ledger.dev/en/help/first-invoice/)
- [Digital signatures: what the Tax Authority requires and how the Ledger meets each rule](https://open-ledger.dev/en/help/digital-signature/)
- [Take payments with Grow, Cardcom or another provider](https://open-ledger.dev/en/help/payment-providers/)
- [Get your expenses into the Ledger](https://open-ledger.dev/en/help/expenses/)
- [Send documents by email, and keep them out of spam](https://open-ledger.dev/en/help/email/)
- [Connect Claude or another AI app (MCP)](https://open-ledger.dev/en/help/connect-claude/)
- [Add or change a key after the install](https://open-ledger.dev/en/help/keys-later/)
- [Updates and backups](https://open-ledger.dev/en/help/updates-backups/)

Source: https://open-ledger.dev/en/help/troubleshooting/
