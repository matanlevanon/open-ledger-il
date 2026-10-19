---
title: Connect Claude or another AI app (MCP)
description: Give Claude Desktop or Claude Code access to your Ledger with the MCP address and token, and what to do when the token is lost.
updated: 2026-10-17
published: true
nav: Connect Claude (MCP)
order: 12
---

With MCP connected, you ask Claude things like "how much does Acme owe me" or "make a payment request for 3 hours of consulting", and Claude works in your Ledger. Claude creates drafts, and finalizes a document only after you confirm.

## Expenses through Claude

Give Claude a supplier invoice or receipt and say "add this as an expense". Claude reads the supplier, date, number, amount and VAT, and records the expense. It waits on the **Expenses** screen with status New, like an expense from email or Drive, until you check and file it.

- When Claude can send the file itself, for example Claude Code with the file in your folder, the original is attached to the expense.
- When it can't, the expense is saved with the note "no file attached yet". Keep the original, or forward it to the expenses email address.
- The same supplier and document number twice, or the same file twice, is marked Duplicate.
- Ask "which expenses are waiting for review" to get the list.
- Add the [Financy]({{financy}}) MCP too, and Claude matches bank and card charges against receipts. Partner link, see [Expenses](/en/help/expenses/).

## What you need

- **The address:** your Ledger's address followed by `/mcp`, for example `https://ledger.acme.co.il/mcp`.
- **The token:** shown once on the installer's last screen.

## Claude Desktop

1. On the installer's last screen you clicked **Download for Claude Desktop**. The file `claude-desktop-<your address>.json` is in your Downloads folder.
2. In Claude Desktop: **Settings > Developer > Edit Config**. The file `claude_desktop_config.json` opens.
3. Copy the `open-ledger` entry from the downloaded file into `mcpServers` in that file. Save.
4. Restart Claude Desktop. This needs Node.js on the computer, from nodejs.org.

## Claude Code

Click **Download for Claude Code** on the installer's last screen and save the file as `.mcp.json` in the folder you work in. Or add the server with the address and the header `Authorization: Bearer <token>`.

## Lost the token

Cloudflare never shows a secret again, so you make a new token. The old one stops working at that moment.

### In the Ledger

1. Open **Settings > MCP**. Only an owner sees this tab.
2. Click **Make a new token**, then **Make the token** to confirm.
3. Copy the token, or click **Download for Claude Desktop** or **Download for Claude Code**. It is shown once.
4. Put it in the Claude config and restart Claude.

The same tab shows the MCP address with a **Copy** button, when the token was last used, and a switch that turns MCP off for every app.

### No MCP tab yet

The tab is in Ledgers updated after 17 October 2026. On an older Ledger, update first, see [Updates](/en/help/updates-backups/). Or set the token in Cloudflare:

1. Look in Downloads for `claude-desktop-....json`. If it is there, the old token is inside and nothing else is needed.
2. Otherwise make a token in PowerShell on your computer:

```
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

3. In dash.cloudflare.com, left menu: **Compute > Workers & Pages**, click **mtn-open-ledger**, then the **Settings** tab. Under **Runtime variables and secrets**, click the pencil on **MCP_TOKEN**, paste the line it printed, and deploy.
