# Connect Claude or another AI app (MCP)

Give Claude Desktop or Claude Code access to your Ledger with the MCP address and token, and what to do when the token is lost.

Updated 2026-10-17

With MCP connected, you ask Claude things like "how much does Acme owe me" or "make a payment request for 3 hours of consulting", and Claude works in your Ledger. Claude creates drafts, and finalizes a document only after you confirm.

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

The tab is in Ledgers updated after 17 October 2026. On an older Ledger, update first, see [Updates](https://open-ledger.dev/en/help/updates-backups/). Or set the token in Cloudflare:

1. Look in Downloads for `claude-desktop-....json`. If it is there, the old token is inside and nothing else is needed.
2. Otherwise make a token in PowerShell on your computer:

`$b = New-Object byte 32; Security.Cryptography.RandomNumberGenerator::Create().GetBytes($b); Convert::ToBase64String($b)`

1. In dash.cloudflare.com: **Workers & Pages**, click **mtn-open-ledger**, then **Settings > Variables and Secrets**. Edit **MCP_TOKEN**, paste the line it printed, and click **Deploy**.

Still stuck? [Write to us from the pricing page.](https://open-ledger.dev/en/pricing/#setup)

## More help

- [Before you install: what you need](https://open-ledger.dev/en/help/before-you-start/)
- [Install Open Ledger IL step by step](https://open-ledger.dev/en/help/install/)
- [Create the Cloudflare API token](https://open-ledger.dev/en/help/cloudflare-token/)
- [First sign-in and setup](https://open-ledger.dev/en/help/first-sign-in/)
- [Give your accountant or assistant access](https://open-ledger.dev/en/help/users/)
- [Connect to the Tax Authority for allocation numbers](https://open-ledger.dev/en/help/tax-authority/)
- [From quote to receipt: your first documents](https://open-ledger.dev/en/help/first-invoice/)
- [Take payments with Grow, Cardcom or another provider](https://open-ledger.dev/en/help/payment-providers/)
- [Get your expenses into the Ledger](https://open-ledger.dev/en/help/expenses/)
- [Send documents by email, and keep them out of spam](https://open-ledger.dev/en/help/email/)
- [Add or change a key after the install](https://open-ledger.dev/en/help/keys-later/)
- [Updates and backups](https://open-ledger.dev/en/help/updates-backups/)
- [Common problems and how to fix them](https://open-ledger.dev/en/help/troubleshooting/)

Source: https://open-ledger.dev/en/help/connect-claude/
