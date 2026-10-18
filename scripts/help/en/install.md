---
title: Install Open Ledger IL step by step
description: Every screen of the Windows installer, from the licence key to the Ledger's address, with what to fill in and what to skip.
updated: 2026-10-18
published: true
nav: Install
cta: buy
order: 2
---

The installer is the paid, connected way to install Open Ledger IL. You buy it once on the shop, and the purchase email brings the licence key and the download link. Read [Before you install](/en/help/before-you-start/) first.

## What the installer saves you

Setting up from the source code is free, and the [setup guide]({{repo}}/blob/main/docs/deploy.md) covers it. The installer skips the hard parts:

- **No Tax Authority API app.** On your own, you register in the Tax Authority developer portal, apply for an API app, wait for approval, and keep its client secret safe. The installer connects you through MTN's approved app. You sign in with your own Tax Authority user and that is all.
- **No Israeli server.** The Tax Authority turns away calls from outside Israel, and Cloudflare often serves a Worker from Frankfurt. On your own, you run a relay on a server with an Israeli address. With the installer, every call goes out through MTN's Israeli route.
- **No command line.** No Node.js, no wrangler, no database ids, no secrets to type. The wizard creates everything in your Cloudflare account in about 3 minutes.
- **Updates in one step.** Run the new installer, and your data stays.

## 1. Download and open the installer

1. Click the download link in the purchase email. The file is `MTN-Open-Ledger-Setup-relay-1.6.0.exe`, about 100 MB.
2. The link works for 72 hours and 5 downloads. If it no longer works, open it anyway and click **Email me a fresh link**.
3. Double-click the file. Windows shows **Windows protected your PC**. Click **More info**, then **Run anyway**. The file is not signed with a paid certificate yet, so Windows warns about every new copy.
4. The installer opens in your browser. Keep that browser tab and the small black window open until the end. Closing either one stops the install.

## 2. Licence key

Paste the licence key and the business tax number. The key works for this number only.

## 3. Cloudflare account

The Ledger runs in your own Cloudflare account. The installer shows three steps, in order.

1. **No Cloudflare account yet?** Sign up at dash.cloudflare.com/sign-up with the business email and verify the email. Skip any offer to add a website.
2. **Turn on Zero Trust and R2.** Click **Show me how** on that step. Both are free, and both ask for a card. Do not create a bucket, the installer does that. Tick **I did it**.
3. **Create the API token.** Follow [Create the Cloudflare API token](/en/help/cloudflare-token/). This is the step where most people get stuck. Tick **I did it**.
4. Paste the token and click **Check token**. Pick the account.
5. Optional, on Windows: tick **Remember the token on this computer**. The next update fills it in. The token is stored encrypted for your Windows user, so anyone signed in as you on this PC could use it. Leave the box empty to paste the token each time.

## 4. Domain or workers.dev

After the token check, the installer asks for the Ledger's web address.

- **With a domain in Cloudflare:** type an address on it, for example `ledger.acme.co.il`. The installer creates it.
- **Without a domain:** tick **Use the free Cloudflare address instead of a domain** and choose a workers.dev name, for example the business name in English. Clients see this address in the links you send. Moving to your own domain later changes the address.

When the account already runs your Ledger, the address is filled in and locked, with the note "This account already runs your Ledger".

## 5. The business

1. Fill in the business name, the owner email and the business type: עוסק פטור, עוסק מורשה or חברה בע"מ. The Ledger asks once more on its first screen, so a mistake here is easy to fix.
2. Under **More people who may sign in**, add your accountant or a second email of your own, one per line. You also add people later, see [Give your accountant access](/en/help/users/).

On an update, the installer reads these details from your Ledger and shows them as a summary. Click **Edit details** to change one. The business type is locked: change it in the Ledger, under **Settings > Tax**.

## 6. Tax Authority

Pick how the Ledger gets allocation numbers for tax invoices. The connected edition fills this in for you: the Ledger connects through MTN, with nothing to type. After the install you sign in once with your Tax Authority user, see [Connect to the Tax Authority](/en/help/tax-authority/).

## 7. Extras

All optional. Each **?** button explains where to get the key.

- **Expense reading:** pick Gemini or Anthropic and paste the key. A Gemini key from aistudio.google.com starts with `AQ.`, older ones with `AIza`.
- **Email sending:** the Resend API key and the sender, written as `Business Name <billing@your-domain.co.il>`. See [Send documents by email](/en/help/email/).
- **Slack alerts:** the webhook address.

Skip anything you do not have. You add it later, see [Add or change a key after the install](/en/help/keys-later/). On an update, keys already set say **Already set. Leave empty to keep it.**

## 8. Install and finish

1. Check the summary and click **Install**. On an update the button reads **Update**. It takes about 3 minutes.
2. The last screen shows the Ledger's address and an **MCP token**. Copy the token now, or click one of the download buttons. See [Connect Claude](/en/help/connect-claude/). Lost it later? **Settings > MCP** in the Ledger makes a new one.
3. It also shows your **email inbox** address, for forwarding receipts. See [Get your expenses into the Ledger](/en/help/expenses/).
4. The installer leaves a summary file on the Desktop, without secrets.
5. If you did not tick **Remember the token on this computer**, delete the Cloudflare API token: dash.cloudflare.com/profile/api-tokens, the three dots next to the token, **Delete**. The Ledger does not need it. If you ticked it, keep the token for the next update.

## Update later

Run the new installer on the same Cloudflare account. It finds your Ledger, fills in the address and the business details, keeps your data and keys, and the last button reads **Update**. On the same computer it also remembers your answers from the last run. See [Updates and backups](/en/help/updates-backups/).

## Next

[First sign-in and setup](/en/help/first-sign-in/).
