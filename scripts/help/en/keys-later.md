---
title: Add or change a key after the install
description: Add the Gemini, Anthropic, Resend, Slack or Google Drive key to your Ledger in the Cloudflare dashboard, without running the installer again.
updated: 2026-10-17
published: true
nav: Add a key later
order: 13
---

The Ledger reads its keys from its Worker in Cloudflare. A Worker is the program that runs the Ledger. You add or change a key there.

## Where

1. Sign in at dash.cloudflare.com.
2. In the left menu, under **Build**, open **Compute > Workers & Pages** and click **mtn-open-ledger**.
3. Open the **Settings** tab. The first section is **Runtime variables and secrets**.
4. Click **Add variable**. Type the name under **Key** and paste the value under **Value**. For a key, tick **Secret**. For a plain setting, leave it clear.
5. Click **Add variable and deploy**. The Ledger uses the new value within a minute.

To change a value that is already there, click the pencil on its row, paste the new value and deploy.

Names are exact, in capital letters.

## Which names

- **Receipt reading with Gemini:** Secret `GEMINI_API_KEY` with the key, and the plain variable `AI_PROVIDER` with the value `gemini`.
- **Receipt reading with Anthropic:** Secret `ANTHROPIC_API_KEY` with the key, and the plain variable `AI_PROVIDER` with the value `anthropic`.
- **Email sending:** Secret `MAIL_API_KEY` with the Resend key, and the plain variable `MAIL_FROM` with the sender, for example `Acme Ltd <billing@acme.co.il>`.
- **Slack alerts:** Secret `SLACK_WEBHOOK_URL`.
- **Google Drive expenses:** Secret `GOOGLE_SERVICE_ACCOUNT_JSON` with the whole content of the JSON key file, from the first `{` to the last `}`. For a folder shared by link, the secret `GOOGLE_API_KEY` with a Google API key instead.
- **MCP token:** Secret `MCP_TOKEN`, see [Connect Claude](/en/help/connect-claude/).

## Rules

- Never paste a key in an email, a chat or a document. Paste it only into Cloudflare or the installer.
- If a key leaks, make a new one at the provider, delete the old one there, and replace it here.
