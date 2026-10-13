# Demo mode

One Worker variable, `DEMO_MODE=1`, turns a Ledger into a public demo. It is the same code and the same locks as a real Ledger. With `DEMO_MODE` empty, nothing in this document runs.

## What a visitor gets

1. **The gate.** The site root shows a form: name and email, required. One marketing box, optional and unticked. A Cloudflare Turnstile check, verified on the server. A privacy notice in English and Hebrew. Entering never depends on the box.
2. **A private sandbox.** Copies of the master sample businesses, owned by a synthetic user tied to the visitor's session. Nobody sees another visitor's data. The session cookie lasts 24 hours. The same email on the same day reopens the same sandbox: from the same browser at once, from another browser after a 6-digit email code (when email is set up).
3. **The real rules.** Drafts edit and delete. Final documents only cancel and credit. Unsigned sent contracts only void. Signed contracts are locked. There is no demo-only delete.
4. **Settings, visible and locked.** Two exceptions stay open, because a real owner does them from Settings: the switch to עוסק מורשה, and Add a business (at most 3 businesses per sandbox).

## What is faked

| Area | In demo mode |
|---|---|
| Watermark | Every PDF and every HTML preview carries "DEMO · NOT A VALID TAX DOCUMENT" in English and Hebrew, diagonal, on every page |
| Downloads and exports | File names start with `DEMO-` |
| Tax Authority | A fake answers inside the Worker. Connect succeeds at once. Allocation numbers start with `DEMO-` and come after 2 seconds (`DEMO_ITA_DELAY_MS`). One invoice in ten is refused, so the refusal flow shows. No call reaches taxes.gov.il or a broker |
| Client email | Never sent. Send shows the email as a preview: "In your own Ledger this email goes to the client." WhatsApp share and Copy link work |
| Contract signing | Works through the link. The email code step shows the code on screen, labelled demo |
| Document reading | Off. A receipt upload gets a fixed sample result, labelled demo |
| PDF signing | The bundled self-signed certificate "Open Ledger IL Demo, not valid" |

Demo mode refuses to start next to real Tax Authority credentials, a relay or broker key, or a signing certificate other than the bundled one. The Worker logs the reason and serves a "Demo misconfigured" page.

## Caps

Per sandbox per day: 50 documents, 30 PDFs, 20 uploads of up to 2 MB, 10 contracts, 3 businesses. Per whole demo per day: `DEMO_DAILY_PDF_CAP` (400) and `DEMO_DAILY_SANDBOX_CAP` (300). A cap reached answers with a plain message and alerts Slack once a day. Every number is a variable: `DEMO_CAP_DOCUMENTS`, `DEMO_CAP_PDFS`, `DEMO_CAP_UPLOADS`, `DEMO_CAP_UPLOAD_MB`, `DEMO_CAP_CONTRACTS`, `DEMO_CAP_BUSINESSES`.

## Leads and consent

- `demo_leads`: name, email, first and last visit, IP, browser, sandbox, webhook status.
- `demo_consents`: the answer, the exact text shown, its version (`DEMO_CONSENT_VERSION`), IP, time, confirmed time, unsubscribed time. Never deleted. Only the confirmed and unsubscribed times are ever set, once each.
- Double opt-in: a ticked box sends one confirmation email with a signed link, when email is set up (`MAIL_API_KEY`, `MAIL_FROM`). Without email the consent is recorded as given and unconfirmed.
- Every email from the demo carries an unsubscribe link.
- Lead capture is optional. It is off unless `DEMO_LEAD_WEBHOOK_URL` and `DEMO_LEAD_SECRET` are both set. Then each lead and each consent change posts as JSON to that URL, server to server, with the header `X-Lead-Secret`. The daily cron retries what failed. The admin page shows the status and a Retry. Point it at your own CRM or form handler.
- The marketing box text is `DEMO_CONSENT_TEXT_EN` and `DEMO_CONSENT_TEXT_HE`. Empty uses a neutral default that names `DEMO_SENDER_NAME`. Raise `DEMO_CONSENT_VERSION` whenever the text changes.

## The master sample set

`demo/seed/sample-set.json`: the businesses, clients, documents, expenses and contracts every sandbox starts from. The contracts use the same neutral Service Agreement and Work Order every new business gets (`src/modules/contracts/seed.ts`). Fake data only: emails on example.com, phones in the 050-0000000 range, ID numbers that pass the checksum and are not issued. Dates count back from yesterday.

The masters load through the Ledger's own services, so numbering and the hash chain are real. They load when missing or when the seed's `version` is higher than the loaded one. A sandbox copies them: clients, services and templates, then each document as a draft finalized through the normal finalize path. Expenses and contracts copy row by row and share the stored files. No PDF renders during the copy.

To change the sample set: edit the JSON, raise `version`, push. The next reset loads the new masters. The old ones become ordinary businesses and the reset after that removes them.

## The nightly reset

A separate Worker (`tools/demo-reset`), with its own bindings to the demo's D1 and files bucket, at 03:00 Israel time, and on `POST /run` with the shared secret.

In one D1 transaction it reads every trigger's SQL, drops the triggers, deletes every row of every sandbox business (child tables first), deletes the sandbox businesses, their sessions and synthetic users, recreates every trigger from the saved SQL, then checks inside the same transaction that every trigger and every master row is exactly what it was. A failed check rolls the whole transaction back and alerts Slack. Then it deletes the sandbox prefixes in the bucket and writes the result to `demo_resets`.

Never touched: leads, consents, lead events, codes, usage, reset history, the masters and everything in them, and the shared tables.

## Admin

`/admin` behind a Cloudflare Access app (it covers `/admin` and `/api/admin`), for the emails in `ADMIN_EMAILS`. The Worker checks the Access JWT itself. Lead totals, opt-in rate, sandboxes today, caps used, the leads table with search and CSV export, consent history, Unsubscribe, webhook status with Retry, Open the sample set as admin (Settings unlocked, every write audited), Reset sandboxes now, and the last reset result.

## Variables

| Name | Kind | Purpose |
|---|---|---|
| `DEMO_MODE` | variable | `1` turns demo mode on |
| `DEMO_PRODUCT_NAME`, `DEMO_SENDER_NAME` | variable | Names on the gate and in the consent text |
| `DEMO_CTA_URL` | variable | The banner's "Get your own Ledger" link |
| `DEMO_CONSENT_VERSION` | variable | Stored with each consent. Change it when the text changes |
| `DEMO_PRIVACY_CONTACT` | variable | The contact the privacy notice names |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET` | variable / secret | The gate's robot check |
| `DEMO_CONSENT_TEXT_EN`, `DEMO_CONSENT_TEXT_HE` | variable | The marketing box text. Empty uses the neutral default |
| `DEMO_LEAD_WEBHOOK_URL`, `DEMO_LEAD_SECRET` | secret | Optional lead capture. Off unless both are set |
| `MAIL_API_KEY`, `MAIL_FROM` | secret, variable | The gate's own emails only |
| `ADMIN_EMAILS`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | variable | The admin |
| `DEMO_RESET_URL`, `DEMO_RESET_SECRET` | variable, secret | "Reset sandboxes now" |
| `SEND_LINK_KEY` | secret | Signs the confirmation, unsubscribe and signing links |
| Caps | variable | See Caps above |

## Privacy notice template

The gate links to `/privacy`, built from these variables. Its text, in English (the Hebrew page says the same):

> **What we store.** The name and email you type at the gate. Your IP address, browser type and the time you entered. Your answer to the updates box, the exact text of the box and the time, and whether you confirmed or unsubscribed. What you create inside the demo.
>
> **Why.** To open a private copy of the demo for you and to stop abuse. Updates and offers go out only if you ticked the box and confirmed by email.
>
> **For how long.** What you create in the demo is deleted every night at 03:00 Israel time. Your name, email and consent record stay until you ask us to delete them.
>
> **Unsubscribe.** Every email from us has an unsubscribe link.

Check the notice with your own lawyer before you run a public demo.

## Run your own demo

A demo runs as its own Worker with its own database and buckets. It never shares a binding or a secret with your own Ledger. `wrangler.toml` has an `[env.sample]` block with placeholders, and `tools/demo-reset/wrangler.toml` holds the reset Worker.

1. Create the D1 database and the two buckets. On your PC: `npx wrangler d1 create open-ledger-sample`, `npx wrangler r2 bucket create open-ledger-sample-files`, `npx wrangler r2 bucket create open-ledger-sample-backups`. Put the database id in place of `REPLACE_WITH_YOUR_SAMPLE_D1_ID` in both `wrangler.toml` files. Do not add a bucket lock rule to the demo buckets: the reset deletes sandbox files.
2. Fill the `[env.sample.vars]` placeholders: `PUBLIC_APP_URL`, `ADMIN_EMAILS`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `TURNSTILE_SITE_KEY`, and the names and texts above. To use a custom domain, uncomment the `routes` line and set your hostname.
3. Cloudflare dashboard: create a Turnstile widget for the hostname, and an Access application covering `/admin` and `/api/admin` for your admin emails.
4. Set the secrets on the demo Worker (`npx wrangler secret put <NAME> --env sample`): `SEND_LINK_KEY`, `DOWNLOAD_SIGN_KEY`, `TURNSTILE_SECRET`, `DEMO_RESET_SECRET`, and optionally `MAIL_API_KEY`, `SLACK_WEBHOOK_URL`, `DEMO_LEAD_WEBHOOK_URL`, `DEMO_LEAD_SECRET`. Never set Tax Authority credentials, a relay or broker key, or a signing certificate. Demo mode refuses to start with any of them.
5. Deploy: `npm run deploy:sample` (applies the demo D1's migrations, then deploys). Deploy the reset Worker from `tools/demo-reset` with `npx wrangler deploy`, and set its `RESET_SECRET` to the same value as `DEMO_RESET_SECRET`.
6. Load the master sample set: `RESET_SECRET=<the reset secret> node scripts/seed-sample.mjs https://open-ledger-sample-reset.<your-subdomain>.workers.dev`. The nightly reset also loads it when missing.
7. Add a rate-limiting rule for the demo hostname (Security > WAF > Rate limiting rules), for example 120 requests a minute per IP.
8. Test in a private window: enter as a visitor, create a receipt and cancel it, sign a sample contract, check `/admin`, press Reset sandboxes now.
