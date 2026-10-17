---
title: Add or change a key after the install
description: Add the Gemini, Anthropic, Resend, Slack or Google Drive key to your Ledger in the Cloudflare dashboard, without running the installer again.
updated: 2026-10-17
published: true
nav: Add a key later
order: 12
---

The Ledger reads its keys from its Worker in Cloudflare. A Worker is the program that runs the Ledger. You add or change a key there.

## Where

1. Sign in at dash.cloudflare.com.
2. Open **Workers & Pages** and click **mtn-open-ledger**.
3. Open **Settings**, then **Variables and Secrets**.
4. Click **+ Add**. Pick **Secret** for keys and **Text** for plain settings. Type the name, paste the value.
5. Click **Deploy**. The Ledger uses the new value within a minute.

Names are exact, in capital letters.

## Which names

- **Receipt reading with Gemini:** Secret `GEMINI_API_KEY` with the key, and Text `AI_PROVIDER` with the value `gemini`.
- **Receipt reading with Anthropic:** Secret `ANTHROPIC_API_KEY` with the key, and Text `AI_PROVIDER` with the value `anthropic`.
- **Email sending:** Secret `MAIL_API_KEY` with the Resend key, and Text `MAIL_FROM` with the sender, for example `Acme Ltd <billing@acme.co.il>`.
- **Slack alerts:** Secret `SLACK_WEBHOOK_URL`.
- **Google Drive expenses:** Secret `GOOGLE_SERVICE_ACCOUNT_JSON` with the whole content of the JSON key file, from the first `{` to the last `}`.
- **MCP token:** Secret `MCP_TOKEN`, see [Connect Claude](/en/help/connect-claude/).

## Rules

- Never paste a key in an email, a chat or a document. Paste it only into Cloudflare or the installer.
- If a key leaks, make a new one at the provider, delete the old one there, and replace it here.
