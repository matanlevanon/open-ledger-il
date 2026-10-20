# Updates and backups

How to check for a new Open Ledger IL version and update with the installer, and where the Ledger keeps its backups.

Updated 2026-10-20

## Check for updates

**Settings > Updates > Check for updates.** The Ledger also checks on the 1st of each month. Nothing installs by itself.

## Update

1. Run the same installer again: `MTN-Open-Ledger-Setup.exe`, the file you kept. It downloads the latest Ledger while it runs. Lost the file? Open the download link from your purchase email. If it no longer works, open it anyway and click **Email me a fresh link**.
2. Run it on the same Cloudflare account, with the same licence key.
3. It updates the Ledger and keeps everything: the database, the files, the sign-in and your keys.

After you paste the Cloudflare token, the installer finds the Ledger in your account and fills in the business details from it. The web address and the business type are locked on an update. Keys already set stay as they are when you leave their fields empty. The summary before **Update** shows the move, for example **Updates your Ledger from 1.5.0 to 1.6.0**. If the installer says it is too old for the current Ledger, download the new installer from your purchase email. On the same computer, the installer also remembers your answers from the last run, and the token too if you tick **Remember the token on this computer** (Windows only, stored encrypted for your Windows user).

## Backups

- Every quarter, the Ledger writes a full copy of its database and a list of every file to its own backup bucket, and tests that the copy restores.
- With Google Drive connected, the same copy also goes to your Drive, outside Cloudflare.
- Every night it checks the numbering for gaps and the documents for changes. **Settings > Backups > Run check now** runs the check on demand.

## Keep Cloudflare safe

The Cloudflare account holds your books. Turn on two-factor sign-in: dash.cloudflare.com, the person icon on the top right, **Profile**, then **Access Management > Authentication**, **Two-Factor Authentication**.

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
- [Common problems and how to fix them](https://open-ledger.dev/en/help/troubleshooting/)

Source: https://open-ledger.dev/en/help/updates-backups/
