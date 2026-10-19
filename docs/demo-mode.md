# Demo mode

One Worker variable, `DEMO_MODE=1`, turns a Ledger into a public demo. It is the same code and the same locks as a real Ledger. With `DEMO_MODE` empty, nothing in this document runs.

## What a visitor gets

1. **The gate.** The site root shows a form: name and email, required. One marketing box, optional and unticked. A Cloudflare Turnstile check, verified on the server. A privacy notice in English and Hebrew. Entering never depends on the box. A deep link without a session gets the gate too.
2. **Instant entry to the shared sample set.** Every visitor opens the same two sample businesses. Entry makes a synthetic visitor user, links it to both businesses and starts a session. Nothing is copied, so entry takes well under 2 seconds.
3. **Read-only sample data.** A visitor cannot issue, cancel, credit, edit, delete, send, record a payment on, or change the settings of anything in the sample set. The server refuses it, with one guard for every route (`src/modules/demo/guard.ts`). The web app hides or disables those buttons and says why in one line: "Read-only in the demo."
4. **Private drafts.** A visitor creates and edits document drafts and their lines, clients, contract drafts and expense uploads. Each row carries the session's key in `demo_session_id`. The sample set has NULL there. Every list, search, count and dashboard shows the sample set plus this session's rows. Another visitor never sees them. The dashboard and reports ignore drafts, as in any Ledger.
5. **Previews instead of actions.** On a visitor's own draft:
   - Issue shows the finished PDF with the number shown as 0000 and a "Demo, not issued" watermark. Nothing is numbered, hashed or locked.
   - Send shows the email in the outbox preview. Nothing is sent.
   - Record payment shows the receipt that would be issued, watermarked.
   - A contract draft opens the real signing page in preview mode. The signer fills and draws, and Sign shows the signed PDF. Nothing is stored as signed.
   The sample set's signed documents and contracts stay viewable as they are.
6. **Deleted on leave.** A session ends after 30 idle minutes. The sweep deletes it and everything tagged with it. Nothing is kept, and nothing is stored in the browser.
7. **A second browser.** The same email with a live session opens straight away from the same browser. From another browser it needs a 6-digit email code (when email is set up), then the session moves there, drafts included.

### How the scoping works

A visitor's requests run on a wrapped D1 (`src/modules/demo/scoped-db.ts`). A read of a tagged table (`documents`, `clients`, `contracts`, `expenses`, `expense_files`, `suppliers`, `demo_outbox`) becomes a subquery of the sample rows plus the session's rows, under the same alias. An insert into a tagged table writes the session key. An insert the wrapper cannot tag fails, so a visitor row can never join the sample set. Child rows (lines, payments, events, contacts) follow their parent. The Ledger's own queries need no change.

The admin's sample-set session reads the sample rows only and writes into the sample set.

## What is faked

| Area | In demo mode |
|---|---|
| Watermark | Every PDF and every HTML preview carries "DEMO · NOT A VALID TAX DOCUMENT" in English and Hebrew, diagonal, on every page |
| Downloads and exports | File names start with `DEMO-` |
| Tax Authority | A fake answers inside the Worker. Connect succeeds at once. Allocation numbers start with `DEMO-` and come after 2 seconds (`DEMO_ITA_DELAY_MS`). One invoice in ten is refused, so the refusal flow shows. No call reaches taxes.gov.il or a broker |
| Client email | Never sent. Send on a draft files the email in the visitor's outbox and shows it: "In your own Ledger this email goes to the client." |
| Issuing | Never happens for a visitor. Issue and Record payment render a preview PDF with the number 0000 and "DEMO · NOT ISSUED" |
| Contract signing | A visitor's contract draft opens the signing page in preview mode, with no code step. Sign returns the PDF and stores nothing. The admin's sample-set session sends and signs for real, with the code shown on screen |
| Document reading | Off. A receipt upload gets a fixed sample result, labelled demo |
| PDF signing | The bundled self-signed certificate "Open Ledger IL Demo, not valid" |

Demo mode refuses to start next to real Tax Authority credentials, a relay or broker key, or a signing certificate other than the bundled one. The Worker logs the reason and serves a "Demo misconfigured" page.

## Caps

Per visitor session per day: 50 drafts, 30 PDFs and previews, 20 uploads of up to 2 MB, 10 contracts. Per whole demo per day: `DEMO_DAILY_PDF_CAP` (400) and `DEMO_DAILY_SANDBOX_CAP` (300 entries). A cap reached answers with a plain message and alerts Slack once a day. Every number is a variable: `DEMO_CAP_DOCUMENTS`, `DEMO_CAP_PDFS`, `DEMO_CAP_UPLOADS`, `DEMO_CAP_UPLOAD_MB`, `DEMO_CAP_CONTRACTS`. `DEMO_CAP_BUSINESSES` is no longer used: a visitor cannot add a business.

## Leads and consent

- `demo_leads`: name, email, first and last visit, IP, browser, webhook status.
- `demo_consents`: the answer, the exact text shown, its version (`DEMO_CONSENT_VERSION`), IP, time, confirmed time, unsubscribed time. Never deleted. Only the confirmed and unsubscribed times are ever set, once each.
- Double opt-in: a ticked box sends one confirmation email with a signed link, when email is set up (`MAIL_API_KEY`, `MAIL_FROM`). Without email the consent is recorded as given and unconfirmed.
- Every email from the demo carries an unsubscribe link.
- Lead capture is optional. It is off unless `DEMO_LEAD_WEBHOOK_URL` and `DEMO_LEAD_SECRET` are both set. Then each lead and each consent change posts as JSON to that URL, server to server, with the header `X-Lead-Secret`. The daily cron retries what failed. The admin page shows the status and a Retry. Point it at your own CRM or form handler.
- The marketing box text is `DEMO_CONSENT_TEXT_EN` and `DEMO_CONSENT_TEXT_HE`. Empty uses a neutral default that names `DEMO_SENDER_NAME`. Raise `DEMO_CONSENT_VERSION` whenever the text changes.

## The master sample set

`demo/seed/sample-set.json`: the businesses, clients, documents, expenses and contracts every visitor sees. The contracts use the same neutral Service Agreement and Work Order every new business gets (`src/modules/contracts/seed.ts`). Fake data only: emails on example.com, phones in the 050-0000000 range, ID numbers that pass the checksum and are not issued. Dates count back from yesterday.

The masters load through the Ledger's own services, so numbering and the hash chain are real. They load when missing or when the seed's `version` is higher than the loaded one.

- **Once at a time.** A build takes a lock (`demo_build_lock`, one row). A second request that finds a build running gets "Preparing the sample data, one moment", a page that reloads every 5 seconds. A lock older than 10 minutes belongs to a build that died, and the next request takes it over.
- **Listed when complete.** A business goes into `demo_master_businesses` only after its last row is in, with a fingerprint of its sample rows. A half-built business is never listed, and the next reset deletes it.
- **Who builds.** The reset Worker at 03:00 and on Reset now. If the masters are missing when a visitor arrives, that request builds them.

To change the sample set: edit the JSON, raise `version`, push. The next reset loads the new masters.

## The sweep and the nightly reset

A separate Worker (`tools/demo-reset`), with its own bindings to the demo's D1 and files bucket. One cron trigger, every 15 minutes, which keeps the account inside the Workers Free cron budget. `POST /run` with the shared secret runs the reset now.

- **The sweep, every run.** Expired visitor sessions (30 idle minutes), their synthetic users, and every row tagged with their session key, with the child rows that hang off them. Then the stored files only those rows pointed to. A file a sample row still points to stays. The result goes to `demo_sweeps`, kept 7 days.
- **The reset, the first run of the 03:00 hour in Israel.** Every session-tagged row whatever its session, every visitor session and user, and every business not listed in `demo_master_businesses` (a half-built business, or a leftover from the R26 copies). Then it checks each master against the seed: missing, older than the seed, short of the seed's rows, or changed since its fingerprint. Only such a master is removed and rebuilt. An admin write refreshes the fingerprint, so an intended change stays.

Each runs as one D1 transaction: read every trigger's SQL, drop the triggers, delete the rows (child tables first), recreate every trigger from the saved SQL, then check inside the same transaction that every trigger and every kept master row is exactly what it was. A failed check rolls the whole transaction back and alerts Slack. A reset while a build holds the lock skips and tries at the next run.

Never touched: leads, consents, lead events, codes, usage, reset and sweep history, the kept masters, and the shared tables.

## Admin

`/admin` behind a Cloudflare Access app (it covers `/admin` and `/api/admin`), for the emails in `ADMIN_EMAILS`. The Worker checks the Access JWT itself. Visitors today, active sessions, drafts created today, PDFs against the cap, lead totals and opt-in rate, the leads table with search and CSV export, consent history, Unsubscribe, webhook status with Retry, the last sweep and the last reset with their times, Open the sample set as admin, and Reset now.

Open the sample set as admin is the only session that changes the sample set. Settings unlock, every write goes to the audit log, and the banner says so.

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
| `DEMO_RESET_URL`, `DEMO_RESET_SECRET` | variable, secret | Admin > Reset now |
| `SEND_LINK_KEY` | secret | Signs the confirmation, unsubscribe and signing links |
| Caps | variable | See Caps above |

## Privacy notice template

The gate links to `/privacy`, built from these variables. Its text, in English (the Hebrew page says the same):

> **What we store.** The name and email you type at the gate. Your IP address, browser type and the time you entered. Your answer to the updates box, the exact text of the box and the time, and whether you confirmed or unsubscribed. What you create inside the demo.
>
> **Why.** To open the demo for you with private drafts and to stop abuse. Updates and offers go out only if you ticked the box and confirmed by email.
>
> **For how long.** What you create in the demo is deleted 30 minutes after you leave, and every night at 03:00 Israel time in any case. Your name, email and consent record stay until you ask us to delete them.
>
> **Unsubscribe.** Every email from us has an unsubscribe link.

Check the notice with your own lawyer before you run a public demo.

## Run your own demo

A demo runs as its own Worker with its own database and buckets. It never shares a binding or a secret with your own Ledger. `wrangler.toml` has an `[env.sample]` block with placeholders, and `tools/demo-reset/wrangler.toml` holds the reset Worker.

1. Create the D1 database and the two buckets. On your PC: `npx wrangler d1 create open-ledger-sample`, `npx wrangler r2 bucket create open-ledger-sample-files`, `npx wrangler r2 bucket create open-ledger-sample-backups`. Put the database id in place of `REPLACE_WITH_YOUR_SAMPLE_D1_ID` in both `wrangler.toml` files. Do not add a bucket lock rule to the demo buckets: the sweep and the reset delete visitor files.
2. Fill the `[env.sample.vars]` placeholders: `PUBLIC_APP_URL`, `ADMIN_EMAILS`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `TURNSTILE_SITE_KEY`, and the names and texts above. To use a custom domain, uncomment the `routes` line and set your hostname.
3. Cloudflare dashboard: create a Turnstile widget for the hostname, and an Access application covering `/admin` and `/api/admin` for your admin emails.
4. Set the secrets on the demo Worker (`npx wrangler secret put <NAME> --env sample`): `SEND_LINK_KEY`, `DOWNLOAD_SIGN_KEY`, `TURNSTILE_SECRET`, `DEMO_RESET_SECRET`, and optionally `MAIL_API_KEY`, `SLACK_WEBHOOK_URL`, `DEMO_LEAD_WEBHOOK_URL`, `DEMO_LEAD_SECRET`. Never set Tax Authority credentials, a relay or broker key, or a signing certificate. Demo mode refuses to start with any of them.
5. Deploy: `npm run deploy:sample` (applies the demo D1's migrations, then deploys). Deploy the reset Worker from `tools/demo-reset` with `npx wrangler deploy`, and set its `RESET_SECRET` to the same value as `DEMO_RESET_SECRET`.
6. Load the master sample set: `RESET_SECRET=<the reset secret> node scripts/seed-sample.mjs https://open-ledger-sample-reset.<your-subdomain>.workers.dev`. The nightly reset also loads it when missing.
7. Add a rate-limiting rule for the demo hostname (Domains > the domain > Security > Security rules > Create rule > Rate limiting rules), for example 120 requests a minute per IP.
8. Test in a private window: enter as a visitor, create a draft receipt and open its Issue preview, open a sample contract, check `/admin`, press Reset now.
