# Give your accountant or assistant access

Add an accountant, an assistant or your second email to the Ledger, in the Ledger and in Cloudflare Access, and remove them again.

Updated 2026-10-17

Each person gets a role per business.

- **Owner:** everything, including Settings, users, numbering and the Tax Authority connection.
- **Assistant:** clients, quotes, payment requests, receipts, sending and expenses. No Settings, users or Tax Authority.
- **Accountant:** reads what you allow, until an end date. Every request is logged. An accountant never issues or cancels a document.

## Add a person

Two places, both needed.

### 1. In the Ledger

1. Pick the business in the switcher at the top.
2. In the sidebar, open **Accountant > Users**.
3. Click **Invite someone**.
4. Type the email and pick the role. An accountant also needs an end date and the feature switches: income documents, expenses, reports, the monthly pack, the unified file.
5. Click **Send invite**.

For your own second email, pick **Owner**.

### 2. In Cloudflare Access

Emails you listed in the installer are there already. For anyone new:

1. Sign in at dash.cloudflare.com and open **Zero Trust**.
2. Go to **Access > Applications** and open **MTN Open Ledger**.
3. Open the **Policies** tab and edit the sign-in policy.
4. Under **Include > Emails**, add the email.
5. Click **Save**.

Until step 5, Cloudflare stops the person at its own sign-in page.

## Remove a person

1. In the Ledger: **Accountant > Users**, click **Revoke** on the row.
2. In Cloudflare Access: remove the email from **Include > Emails** and save.

Still stuck? [Write to us from the pricing page.](https://open-ledger.dev/en/pricing/#setup)

## More help

- [Before you install: what you need](https://open-ledger.dev/en/help/before-you-start/)
- [Install Open Ledger IL step by step](https://open-ledger.dev/en/help/install/)
- [Create the Cloudflare API token](https://open-ledger.dev/en/help/cloudflare-token/)
- [First sign-in and setup](https://open-ledger.dev/en/help/first-sign-in/)
- [Connect to the Tax Authority for allocation numbers](https://open-ledger.dev/en/help/tax-authority/)
- [From quote to receipt: your first documents](https://open-ledger.dev/en/help/first-invoice/)
- [Digital signatures: what the Tax Authority requires and how the Ledger meets each rule](https://open-ledger.dev/en/help/digital-signature/)
- [Take payments with Grow, Cardcom or another provider](https://open-ledger.dev/en/help/payment-providers/)
- [Get your expenses into the Ledger](https://open-ledger.dev/en/help/expenses/)
- [Send documents by email, and keep them out of spam](https://open-ledger.dev/en/help/email/)
- [Connect Claude or another AI app (MCP)](https://open-ledger.dev/en/help/connect-claude/)
- [Add or change a key after the install](https://open-ledger.dev/en/help/keys-later/)
- [Updates and backups](https://open-ledger.dev/en/help/updates-backups/)
- [Common problems and how to fix them](https://open-ledger.dev/en/help/troubleshooting/)

Source: https://open-ledger.dev/en/help/users/
