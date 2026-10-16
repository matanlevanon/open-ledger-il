# ledger-inbox

An Email Worker that turns receipts forwarded by email into Open Ledger IL expenses. Each Ledger
install gets a private address like `r7k2m9x4qp@in.example.com`. The owner forwards receipts there
from Gmail or Outlook. The gateway passes each message to the Ledger, which reads it and makes an
expense waiting for review.

A Ledger can also take email without this gateway, on a domain of its own. See
`docs/expense-inbox.md` in the main repo.

## What it sees and keeps

- It keeps one row per install: the inbox id, the Ledger address, the signing secret, the licence
  id and the Cloudflare account id and tax number the licence is bound to.
- It stores no message. Each message passes through in memory, from Email Routing to the Ledger.
- It logs the inbox row number, the Ledger's answer code and the message size. Never an address,
  a subject or any content.

## How a message flows

1. Email Routing on the inbox domain sends every address to this Worker.
2. The local part names the install. Unknown, paused, or a licence that is no longer active:
   rejected as "Unknown address". Over 20 MB: rejected as "Too large".
3. The raw message is POSTed to `<ledger>/api/inbox` with `X-Inbox-Id`, `X-Inbox-Timestamp`,
   `X-Ledger-Envelope-From` and `X-Inbox-Signature`, an HMAC-SHA256 hex of
   `<timestamp>.<envelope from>.<SHA-256 hex of the body>` with the install's secret.
4. The Ledger answers 5xx or does not answer in 30 seconds: the message is rejected with
   "Temporary problem, try again later". It answers 4xx: rejected as "Refused by the Ledger".

Email Workers cannot choose the SMTP code of a rejection, so a temporary problem is said in the
reason text only. Most senders then bounce the message, and the owner forwards it again.

## Routes

| Route | Body | Answer |
|---|---|---|
| `POST /register` | `{ origin, licence, accountId, taxId }` | `{ inboxId, address, secret }`. The same licence again keeps the address and makes a new secret |
| `POST /rotate` | `{ inboxId, timestamp }`, header `X-Inbox-Signature`: HMAC-SHA256 hex of `<timestamp>.<body>` | `{ inboxId, address }`. The old address stops at once |
| `GET /health` | | `{ ok: true }` |

The installer calls `/register`. The Ledger calls `/rotate` from Settings > Expenses > Email inbox.

## Set up

1. `npx wrangler d1 create ledger-inbox`, put the id in `wrangler.toml`, then
   `npx wrangler d1 migrations apply DB --remote`.
2. Set `INBOX_DOMAIN` in `wrangler.toml`.
3. Secrets: `LICENCE_URL` and `LICENCE_SECRET`, the licence service the login broker uses.
4. `npx wrangler deploy`.
5. Cloudflare dashboard > your domain > Email > Email Routing: add the inbox subdomain, add its
   DNS records, and set its catch-all to "Send to a Worker", `ledger-inbox`.

## Tests

`node test/inbox.test.mjs`, on fakes: D1 in SQLite, a fake licence service and a fake Ledger.
