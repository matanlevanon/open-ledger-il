# Updates and backups

How to check for a new Open Ledger IL version and update with the installer, and where the Ledger keeps its backups.

Updated 2026-10-17

## Check for updates

**Settings > Updates > Check for updates.** The Ledger also checks on the 1st of each month. Nothing installs by itself.

## Update

1. Open the download link from your purchase email. If it no longer works, open it anyway and click **Email me a fresh link**.
2. Run the new installer on the same Cloudflare account, with the same licence key.
3. It updates the Ledger and keeps everything: the database, the files, the sign-in and your keys.

## Backups

- Every quarter, the Ledger writes a full copy of its database and a list of every file to its own backup bucket, and tests that the copy restores.
- With Google Drive connected, the same copy also goes to your Drive, outside Cloudflare.
- Every night it checks the numbering for gaps and the documents for changes. **Settings > Backups > Run check now** runs the check on demand.

## Keep Cloudflare safe

The Cloudflare account holds your books. Turn on two-factor sign-in: dash.cloudflare.com, your profile, **Authentication**, **Two-Factor Authentication**.

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
