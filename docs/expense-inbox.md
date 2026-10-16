# Expense inbox: receipts forwarded by email

Each Ledger can take receipts by email. Every forwarded email becomes an expense in **Expenses**,
read by AI when a reading key is set, and waiting for the owner's check.

There are two ways in. Both end in the same parser and the same sender rule.

## Path 1: an email gateway

The gateway is `tools/ledger-inbox`, an Email Worker that serves many installs from one inbox
domain. Its README has the setup.

1. An installer calls the gateway `POST /register` with the install address and a licence key.
   The gateway checks the licence with the licence service and returns an inbox id, an address
   like `r7k2m9x4qp@in.example.com` and a secret.
2. The Ledger keeps the id, the address and the gateway address as settings (`expenses.inbox_id`,
   `expenses.inbox_address`, `expenses.inbox_gateway`) and the secret as the Worker secret
   `INBOX_SECRET`. Cloudflare Access needs a bypass app for `<host>/api/inbox`, as for `/mcp`.
3. Email Routing on the inbox domain sends every address to the gateway.
4. The gateway finds the install by the local part, checks its licence, and POSTs the raw message
   to `<ledger>/api/inbox`, signed with HMAC-SHA256 over `<timestamp>.<envelope sender>.<SHA-256 of
   the body>`.
5. The Ledger checks the signature in constant time, refuses a timestamp more than 5 minutes off,
   and refuses a signature it saw in the last 10 minutes (`inbox_signatures`).

The gateway gives up on a message, with a reject the sender sees, when:

| Case | Reject reason |
|---|---|
| Unknown address, paused inbox, licence no longer active | Unknown address |
| Over 20 MB | Too large |
| The Ledger answers 5xx or not within 30 seconds | Temporary problem, try again later |
| The Ledger answers 4xx, for example the inbox is off | Refused by the Ledger |

Email Workers cannot pick the SMTP code, so "temporary" is in the wording only.

**What the gateway sees and keeps.** It keeps one row per install: the inbox id, the Ledger
address, the signing secret, the licence id, and the account id and tax number the licence is
bound to. It stores no message. Each message passes through in memory. Its logs hold the row
number, the Ledger's answer code and the size, never an address, a subject or any content.

**A new address.** Settings > Expenses > Email inbox > Make a new address calls the gateway
`POST /rotate`, signed with `INBOX_SECRET`. The old address stops at once.

## Path 2: a domain of your own

No gateway. The Ledger Worker has an `email()` handler.

1. Cloudflare dashboard > your domain > Email > Email Routing. Turn it on and add its DNS records.
2. Add a routing rule: an address such as `receipts@your-domain.co.il`, action "Send to a
   Worker", your Ledger's Worker.
3. Forward receipts to that address.

Cloudflare delivers the message to the Worker, so there is no signature. The sender rule, the
size limit and the switch apply as on path 1. Settings shows no address for this path: you
picked it.

## The sender rule

The envelope sender (the gateway's `X-Ledger-Envelope-From`, or `message.from` on path 2) must be
on the allowed list, `expenses.inbox_senders`. Until the owner edits it, the list is the owner
email (`OWNER_EMAIL`) and every active owner and assistant of business 1. Gmail rewrites a
forwarded envelope by adding a `+caf_=...` tag to your Gmail address. The `+...` part is ignored
when comparing.

Any other sender: the Ledger answers 200, makes nothing, and adds a line to the inbox log
("Ignored, from x@y, not on your list").

One exception: Gmail's forwarding check from `forwarding-noreply@google.com`. Its code and link
are stored (`expenses.inbox_gmail_confirmation`) and shown in Settings. It makes no expense.

## What becomes an expense

- Each PDF, JPG, PNG, WebP or HEIC attachment becomes one expense through the Upload path: the
  file in R2, its SHA-256, AI reading when a key is set, status `new`.
- Inline images under 20 KB are skipped (logos, signatures).
- No attachment: the body is saved as an `.html` file, read from its text, and marked "From email
  text, check the amount". The file is served with a sandbox CSP, so it runs no script.
- The note keeps the sender name and the subject.
- The same file twice is one expense. The second shows as a duplicate in the log.
- A file the reader cannot read still becomes an expense waiting for review, with no amount.
- Every email goes to business 1.

## Settings > Expenses > Email inbox

Owner only, hidden in the demo. The address with Copy, the **Inbox on** switch, the allowed
senders, the Gmail confirmation code, the Gmail and Outlook steps, the last 10 emails, and
**Make a new address**. With the inbox off, the Ledger answers 403 and the gateway rejects the
email, so the sender sees it bounce.

## Where it lives

| Part | Where |
|---|---|
| Endpoint, parser, sender rule | `src/modules/expenses/inbox.ts`, `inbox-routes.ts` |
| Own-domain handler | `email()` in `src/index.ts` |
| Tables | `migrations/3500_expense_inbox.sql`: `inbox_signatures`, `inbox_events` |
| Settings section | `web/src/features/settings/InboxSection.tsx` |
| Gateway | `tools/ledger-inbox/` |
