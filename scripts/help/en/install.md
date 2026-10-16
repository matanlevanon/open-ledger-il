---
title: Install Open Ledger IL step by step
description: Every screen of the Windows installer, from the licence key to the Ledger's address, with what to fill in and what to skip.
updated: 2026-10-17
published: true
order: 2
---

Read [Before you install](/help/before-you-start/) first. Keep the purchase email open, you need the key and the download link.

## 1. Download and open the installer

1. Click the download link in the purchase email. The file is `MTN-Open-Ledger-Setup-relay-1.6.0.exe`, about 100 MB.
2. The link works for 72 hours and 5 downloads. If it no longer works, open it anyway and click **Email me a fresh link**.
3. Double-click the file. Windows shows **Windows protected your PC**. Click **More info**, then **Run anyway**. The file is not signed with a paid certificate yet, so Windows warns about every new copy.
4. The installer opens in your browser. Keep that browser tab and the small black window open until the end. Closing either one stops the install.

## 2. Licence key and business

1. Paste the licence key and the business tax number.
2. Fill in the business name, the owner email and the business type: עוסק פטור, עוסק מורשה or חברה בע"מ. The Ledger asks once more on its first screen, so a mistake here is easy to fix.
3. Under **More people who may sign in**, add your accountant or a second email of your own, one per line. You also add people later, see [Give your accountant access](/help/users/).

## 3. Cloudflare account

The Ledger runs in your own Cloudflare account. The installer shows three steps, in order.

1. **No Cloudflare account yet?** Sign up at dash.cloudflare.com/sign-up with the business email and verify the email. Skip any offer to add a website.
2. **Turn on Zero Trust and R2.** Click **Show me how** on that step. Both are free, and both ask for a card. Do not create a bucket, the installer does that. Tick **I did it**.
3. **Create the API token.** Follow [Create the Cloudflare API token](/help/cloudflare-token/). This is the step where most people get stuck. Tick **I did it**.
4. Paste the token and click **Check token**. Pick the account.

## 4. Domain or workers.dev

After the token check, the installer asks for the Ledger's web address.

- **With a domain in Cloudflare:** type an address on it, for example `ledger.acme.co.il`. The installer creates it.
- **Without a domain:** tick **Use the free Cloudflare address instead of a domain** and choose a workers.dev name, for example the business name in English. Clients see this address in the links you send. Moving to your own domain later changes the address.

## 5. Tax Authority

Pick how the Ledger gets allocation numbers for tax invoices. The connected edition fills this in for you: the Ledger connects through MTN, with nothing to type. After the install you sign in once with your Tax Authority user, see [Connect to the Tax Authority](/help/tax-authority/).

## 6. Extras

All optional. Each **?** button explains where to get the key.

- **Expense reading:** pick Gemini or Anthropic and paste the key. A Gemini key from aistudio.google.com starts with `AQ.`, older ones with `AIza`.
- **Email sending:** the Resend API key and the sender, written as `Business Name <billing@your-domain.co.il>`. See [Send documents by email](/help/email/).
- **Slack alerts:** the webhook address.

Skip anything you do not have. You add it later, see [Add or change a key after the install](/help/keys-later/).

## 7. Install and finish

1. Check the summary and click **Install**. It takes about 3 minutes.
2. The last screen shows the Ledger's address and an **MCP token**. Copy the token now, or click one of the download buttons. Cloudflare never shows it again. See [Connect Claude](/help/connect-claude/).
3. The installer leaves a summary file on the Desktop, without secrets.
4. Delete the Cloudflare API token: dash.cloudflare.com/profile/api-tokens, the three dots next to the token, **Delete**. The Ledger does not need it any more.

## Next

[First sign-in and setup](/help/first-sign-in/).
