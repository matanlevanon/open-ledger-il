---
title: Updates and backups
description: How to check for a new Open Ledger IL version and update with the installer, and where the Ledger keeps its backups.
updated: 2026-10-18
published: true
nav: Updates and backups
order: 14
---

## Check for updates

**Settings > Updates > Check for updates.** The Ledger also checks on the 1st of each month. Nothing installs by itself.

## Update

1. Open the download link from your purchase email. If it no longer works, open it anyway and click **Email me a fresh link**.
2. Run the new installer on the same Cloudflare account, with the same licence key.
3. It updates the Ledger and keeps everything: the database, the files, the sign-in and your keys.

After you paste the Cloudflare token, the installer finds the Ledger in your account and fills in the business details from it. The web address and the business type are locked on an update. Keys already set stay as they are when you leave their fields empty. On the same computer, the installer also remembers your answers from the last run, and the token too if you tick **Remember the token on this computer** (Windows only, stored encrypted for your Windows user).

## Backups

- Every quarter, the Ledger writes a full copy of its database and a list of every file to its own backup bucket, and tests that the copy restores.
- With Google Drive connected, the same copy also goes to your Drive, outside Cloudflare.
- Every night it checks the numbering for gaps and the documents for changes. **Settings > Backups > Run check now** runs the check on demand.

## Keep Cloudflare safe

The Cloudflare account holds your books. Turn on two-factor sign-in: dash.cloudflare.com, the person icon on the top right, **Profile**, then **Access Management > Authentication**, **Two-Factor Authentication**.
