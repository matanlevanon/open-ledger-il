---
title: Updates and backups
description: How to check for a new Open Ledger IL version and update with the installer, and where the Ledger keeps its backups.
updated: 2026-10-17
published: true
nav: Updates and backups
order: 13
---

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
