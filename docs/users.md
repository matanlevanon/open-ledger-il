# Users and businesses

The Ledger holds one or more businesses. Each person gets a role per business.

| Role | What it can do |
|---|---|
| Owner | Everything: Settings, users, numbering, the business type switch, the Tax Authority connection. |
| Assistant | Clients, quotes, payment requests, pro formas, receipts, sending and expenses. No Settings, numbering, users or Tax Authority. |
| Accountant | Reads what the feature switches allow, until the end date. Every request is logged. |

A business always keeps one owner. The Ledger refuses to remove or downgrade the last one.

## Add a person, or your second email

Two places, both needed. The Ledger cannot add an email to Cloudflare Access.

### 1. In the Ledger

1. Open the business in the top-bar switcher.
2. Go to **Accountant > Users** in the sidebar.
3. Click **Invite someone**.
4. Type the email. Pick the role. An accountant also needs an end date and feature switches.
5. Click **Send invite**. The Ledger shows one line: "Also add this email to your Cloudflare Access policy".

For your own second email, pick **Owner**. Repeat in each business it should open.

### 2. In Cloudflare Access

1. Sign in at dash.cloudflare.com.
2. Open **Zero Trust**.
3. Go to **Access > Applications**.
4. Open the ledger app.
5. Open the **Policies** tab. Edit the sign-in policy.
6. Under **Include > Emails**, add the email.
7. Save.

Until step 7, Access stops the person at its own sign-in page. The Ledger never sees them.

## Remove a person

1. In the Ledger, **Accountant > Users**, click **Revoke** on the row.
2. In Cloudflare Access, remove the email from **Include > Emails**.

Revoking a person in one business leaves their roles in the other businesses.

See `cloudflare-access.md` for the first-time Access setup and `accountant-access.md` for the accountant's feature switches.
