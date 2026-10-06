# Deploy

Click-by-click steps to take Open Ledger IL from this repo to a live Worker at
`ledger.example.com`, on the Workers Paid plan ($5 a month minimum, see section 12). Each step says where it runs: the
**Cloudflare dashboard**, **Cloudflare dashboard** or **your computer** (a terminal with `npx wrangler` and `git`).

Do these once, in order, for the first deploy. `docs/secrets.md` is the reference for every
secret and variable named below. This file is the sequence to set them all up.

## 1. Create the one D1 database

**Cloudflare dashboard.**

1. Go to **Workers & Pages** > **D1 SQL database** ([direct link](https://dash.cloudflare.com/?to=/:account/workers/d1)).
2. Select **Create Database**. Name it `open-ledger-il`. Leave the location hint on automatic unless
   you know most reads happen from a specific region. Select **Create**.
3. Copy the new database's ID (shown on its overview page).

There is only one D1 database in production. R14's quarterly backup restore test
(`src/modules/ops/backup.ts`) rebuilds the hash chain and every `allocation_records` hash straight
from the R2 export, entirely in memory, so it never needs a second database to restore into.

## 2. Create the two R2 buckets

**Cloudflare dashboard.**

1. Go to **R2 object storage** ([direct link](https://dash.cloudflare.com/?to=/:account/r2/overview)).
2. Select **Create bucket**. Name it `open-ledger-il-files`. Leave location on automatic. Select
   **Create bucket**.
3. Repeat for a second bucket named `open-ledger-il-backups`. This is R14's quarterly backup exports
   and manifests. Keep it separate from `open-ledger-il-files`, so a backup run never competes with
   the retention lock below.

### Lock `open-ledger-il-files` against deletion (docs/legal-requirements.md, instruction 25: 7-year retention)

R2 has no dashboard button for this yet. It is a Wrangler command only.

**Your computer**, once authenticated (`npx wrangler login`):

```
npx wrangler r2 bucket lock add open-ledger-il-files --name seven-year-retention --retention-days 2557
```

2,557 days covers 7 years, including leap days. This blocks deletion or overwrite of every object
in the bucket for that long. It does not block reads, and it does not need repeating. Skip this
for `open-ledger-il-backups`. A backup restore test only ever reads its own export back from this
bucket and recomputes hashes in memory; it never writes anywhere, so no lock is needed there. Do
not lock a bucket you still expect to prune.

## 3. Browser Rendering: no setup needed

R02's PDF rendering uses Browser Rendering (the `BROWSER` binding in `wrangler.toml`). It needs no
separate creation step. It activates the first time the Worker uses it. The Workers Free plan
includes 10 minutes of browser time a day and 3 concurrent browsers, at no charge. Watch this if
document volume grows. Past that daily limit, PDF rendering starts failing with a 429 until the
next UTC day. The fix is upgrading to Workers Paid (10 hours a month included).

## 4. Set up Cloudflare Access

**Cloudflare dashboard**, in **Zero Trust** (a separate area from Workers & Pages. The sidebar has
its own switcher, or go to [dash.cloudflare.com/?to=/:account/access/apps](https://dash.cloudflare.com/?to=/:account/access/apps)).

1. Go to **Access controls** > **Applications**.
2. Select **Add an application** > **Self-hosted**.
3. Name it "Open Ledger IL". Under **Application domain**, add the public hostname:
   `ledger.example.com`.
4. Add a policy: **Allow**, rule type **Emails**, values = your own email and any accountant's
   email who should sign in. Start with just the owner email. Add an accountant's email later
   from this same screen when you actually invite one. Their `users` row still needs to exist in
   the app too, from **Access** > **Users** in Open Ledger IL itself, or the owner-bootstrap flow
   below for the first sign-in.
5. Save the application.
6. On the application's **Overview**, copy its **Application Audience (AUD) Tag**. Your **team
   domain** is shown in **Zero Trust** > **Settings** > **Custom Pages** (or **Zero Trust** >
   **Settings** > **General**) as `https://<your-team-name>.cloudflareaccess.com`. You need both
   values in step 5 below.

The domain `ledger.example.com` does not need to exist yet. You are about to create it as a
Custom Domain on the Worker in step 7.

### Second application: public client links (Bypass)

Clients open two links without a Cloudflare Access session: the consent page and the WhatsApp PDF
share link, both under `/api/sending/public/` (`src/modules/sending/public-paths.ts`). With Access
on the whole domain, clients hit a sign-in wall. Add a second, more specific application:

1. **Add an application** > **Self-hosted**. Name it "Open Ledger IL public links".
2. Domain `ledger.example.com`, path `api/sending/public`.
3. Policy: name "Public client links", action **Bypass**, include **Everyone**. Save.

Access applies the most specific path first, so only these links skip sign-in. Each one still
carries a signed token that the Worker verifies inside the route.

## 5. Push the real D1 ID and non-secret variables to the repo

**Your computer.** It is a normal git commit in your own fork, never a dashboard edit, so a future
deploy cannot silently revert it.

1. Open `wrangler.toml`.
2. Replace `database_id = "REPLACE_WITH_YOUR_D1_ID"` with the real ID from step 1.
3. Replace the placeholder `[vars]`:
   - `ACCESS_TEAM_DOMAIN` = your team domain from step 4.6, e.g.
     `https://your-team.cloudflareaccess.com`
   - `ACCESS_AUD` = the AUD tag from step 4.6
   - `OWNER_EMAIL` = your own sign-in email (the first sign-in from this email becomes the owner,
     once, while no owner row exists yet)
   - `PUBLIC_APP_URL` = `https://ledger.example.com`
   - `MAIL_FROM` = the sender for outgoing email, for example
     `Sample Business Ltd <billing@example.com>`, on a domain verified in Resend
   - Uncomment the `routes` block and set your own hostname
4. Commit and push to `main` of your fork. None of these values is a secret by CLAUDE.md rule
   5's own list (ITA client secret, signing key, encryption key, ת"ז). If your fork is public,
   keep them out of it: Set them as plain (non-secret) **Variables**
   in the Worker's dashboard settings instead (step 8's screen has a **Variable** type alongside
   **Secret**), and add `keep_vars = true` to `wrangler.toml`. That stops the next Workers Builds
   deploy from overwriting them with the empty defaults still in the file.

## 6. Connect the Worker to this GitHub repository

**Cloudflare dashboard.**

1. Go to **Workers & Pages** ([direct link](https://dash.cloudflare.com/?to=/:account/workers-and-pages)).
2. Select **Create application** (or **Create**) > **Import a repository**, and connect your
   GitHub account if this is the first time.
3. Select your fork of this repository and the `main` branch.
4. Set **Build command** to `npm ci && npm run build:web`. This runs Vite and produces `web/dist`,
   the static assets the Worker serves. Leave **Deploy command** at its default,
   `npx wrangler deploy`.
5. Set **Root directory** to `/` (the repository root, where `wrangler.toml` lives).
6. The dashboard reads the Worker's `name` from `wrangler.toml` (`open-ledger-il`) and uses it as the
   project name. Do not rename it in the dashboard. A mismatch fails every future build.
7. Select **Save and Deploy**. This kicks off the first build and deploy from `main`.

## 7. Add the Custom Domain

**Cloudflare dashboard**, once your domain (`example.com` here) itself is an active zone on this
Cloudflare account. Add it first under **Websites** if it is not already there. DNS for the rest
of the domain keeps working as before. This only adds one new subdomain's routing.

1. Open the `open-ledger-il` Worker (**Workers & Pages** > the Worker).
2. Go to the **Domains** tab (or **Settings** > **Domains & Routes**).
3. Select **Add** > **Custom Domain**.
4. Enter `ledger.example.com`. Select **Add Custom Domain**.

Cloudflare creates the DNS record and certificate for you. There must be no existing CNAME record
for `ledger` on this zone first, or the add is refused.

## 8. Add every secret

**Cloudflare dashboard.**

1. Open the `open-ledger-il` Worker > **Settings** > **Variables and Secrets**.
2. Select **Add** for each row below. Set **Type** to **Secret**, the **Variable name** exactly as
   shown, and paste the value. Select **Add variable** to add the next one without leaving the
   screen. Select **Deploy** once all of them are entered, to roll out a Worker version that can
   read them.

| Name | Where the value comes from |
|---|---|
| `OWNER_TAX_ID` | Your ID number (ת"ז). The ITA user id, and the fallback when Settings > Business has no tax id |
| `SIGNING_KEY_PEM` | PDF signing private key. Made by `node scripts/make-signing-cert.mjs "Your Business Name"`, run on your computer. Ask your accountant whether you need a certificate from a licensed authority instead |
| `SIGNING_CERT_PEM` | PDF signing certificate, from the same script |
| `ITA_CLIENT_ID_SANDBOX`, `ITA_CLIENT_SECRET_SANDBOX` | ITA developer portal, sandbox app registration |
| `ITA_CLIENT_ID_PRODUCTION`, `ITA_CLIENT_SECRET_PRODUCTION` | ITA developer portal, production app registration, once approved |
| `ITA_TOKEN_KEY` | 32 random bytes, base64. Generate on your computer: `openssl rand -base64 32` |
| `ITA_VAT_NUMBER` | Optional. Business VAT number once עוסק מורשה. Leave unset until then |
| `ANTHROPIC_API_KEY` | Anthropic console, a key scoped to this Worker's use. Reads expense documents (R07) and, since R17, "Upload existing documents" under Import; unset, both fall back to a manual-entry review screen |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Cloud service account, the full JSON key file's contents as one value. Used both for expense ingest (reads `<root>/YYYY-MM`) and, since R16 task 12, the quarterly backup's off-site copy (writes `<root>/Backups/YYYY-Qn`), so the service account needs **Editor** access on your expenses root folder, shared from Drive's own sharing dialog, not just Viewer |
| `SLACK_WEBHOOK_URL` | Optional. An incoming webhook for a Slack channel of your choice |
| `DOWNLOAD_SIGN_KEY` | 32 random bytes, base64: `openssl rand -base64 32` |
| `MAIL_API_KEY` | Resend dashboard, an API key |
| `SEND_LINK_KEY` | 32 random bytes, base64: `openssl rand -base64 32` |
| `MCP_TOKEN` | 32 random bytes, base64, or any long random string: `openssl rand -base64 32` |

Never paste a secret value into a chat, an issue, a PR, or a commit. Generate the random ones on
your computer with the commands above and paste the result straight into the dashboard field.

Sandbox and production ITA credentials sit under separate names on purpose (CLAUDE.md rule 7).
`ITA_ENV` in `wrangler.toml` picks which pair the Worker actually uses. It is `sandbox` until you
deliberately flip it once ITA production access is approved.

`GOOGLE_SERVICE_ACCOUNT_JSON` alone is not enough: expense ingest and the quarterly backup's
off-site copy both read the root folder's Drive id from a setting
(`expenses.drive_root_folder_id`), set once from **Settings** > **Expenses** after first sign-in,
not from a secret or `wrangler.toml` variable. Until that setting is made, expense ingest has
nothing to read from and the backup logs a warning and skips its off-site copy (never fails the
R2 backup itself, R16 task 12).

## 9. Apply the D1 migrations

`wrangler deploy` (what Workers Builds runs on every push) never applies D1 migrations by itself.
It only ships the Worker code. Migrations are a separate command.

**Your computer**, once authenticated (`npx wrangler login`):

```
npx wrangler d1 migrations apply DB --remote
```

Run this again after every deploy that adds a new file under `migrations/`.

### Windows line endings: `.gitattributes`

If you ever edit or create a migration file on Windows, check `.gitattributes` at the repo root
first: `*.sql text eol=lf` forces every `migrations/*.sql` file to LF line endings on checkout,
regardless of a Windows editor's or Git's own `core.autocrlf` setting. CRLF line endings inside a
migration break `wrangler d1 migrations apply`: a trigger body that spans multiple lines (most of
`migrations/0002_integrity.sql` and later) reads as incomplete input and the whole migration
fails partway through. If a future migration file still ends up CRLF (a copy-paste from a Windows
tool that bypassed Git's checkout, for example), re-save it as LF before committing; do not weaken
or remove the `.gitattributes` rule to work around it.

## 10. Confirm the cron triggers

**Cloudflare dashboard.** Open the Worker > **Settings** > **Trigger Events** > **Cron Triggers**.
The five schedules from `wrangler.toml`'s `[triggers]` block should already be listed. Workers
Builds reads them from the file on every deploy, so there is nothing to add here. Just check the
count (5) and a couple of the times match `wrangler.toml`, in case a future edit to that file
missed one.

## 11. First sign-in and smoke test

1. Visit `https://ledger.example.com/api/health` in a browser. Expect
   `{"ok":true,"service":"open-ledger-il","environment":"production"}`.
2. Visit `https://ledger.example.com/` (the app itself). Cloudflare Access should intercept
   with its sign-in page. Sign in as the `OWNER_EMAIL` address from step 5. The first sign-in
   from that address creates the owner row (`src/core/auth.ts`'s `bootstrapOwner`). Every later
   sign-in from that address reuses the same row. The app then shows the first-run setup screen.
   Fill in the business profile, logo and signature as `docs/setup.md` describes.
3. Create one client, then issue and finalize one real receipt end to end. Use a quote or a
   payment request first if you want the full flow, or a plain receipt directly. Confirm the PDF
   renders, is signed (CLAUDE.md rule 5's PAdES signature, not a stub), and downloads.
4. Confirm the receipt's number is 1 in its series (or continues correctly from an imported
   SUMIT or Wave series start, if you ran an import first). Confirm a second
   receipt gets the next number with no gap.
5. Open **Settings** > **Exchange rates** and select **Fetch rates now**. Confirm USD, EUR and GBP
   each show a latest cached date and rate afterward: the first real proof the Worker can reach
   the Bank of Israel series endpoint from production, not only from the daily cron.


### Setting series start numbers from SUMIT

Skip this if an import already set the series starts for you. To set
them by hand instead (a fresh number series with no SUMIT import):

1. In SUMIT, find the last number actually issued for each document type you are carrying over
   (quotes, payment requests, receipts, and, once in מורשה mode, tax invoices). SUMIT shows this on
   each document list's own numbering column, or in its own settings.
2. In Open Ledger IL, sign in as the owner and open **Settings** > **Numbering**. Each row is one
   document type's series, with its current starting number.
3. For each type you are continuing from SUMIT, set the starting number to **one more than** the
   last number SUMIT actually issued, so the very next document Open Ledger IL issues in that series
   picks up where SUMIT left off, with no gap and no collision.
4. Do this **before** issuing the first real document in that series. The starting number locks
   the moment a series is used (`NumberingError('series_started', ...)`, `src/core/errors.ts`): a
   series with even one issued document cannot have its starting number changed afterward, only a
   brand-new series could be opened instead, which is not what a continuing SUMIT client wants.
5. A series you are not continuing from anywhere (a document type new to Open Ledger IL) can stay at
   its default starting number, 1.

## 12. Worker plan and CPU time

The Worker declares 5 cron triggers, the most Workers Free allows per account (Paid allows 250).
Jobs that need a day of the month share a daily trigger and check the date themselves. Workers
Free runs the ledger. These Free limits are the ones to watch, and Workers Paid ($5 a month
minimum per account) lifts all of them. The accountant pack and the quarterly backup are the jobs
most likely to hit the cron CPU limit:

- **CPU time**: 10 ms per HTTP request on Free, versus 30 seconds (up to 5 minutes) on Paid. CPU
  time only counts active JavaScript execution, not time spent waiting on D1, R2, Browser
  Rendering, or an outbound `fetch` (BOI rates, the ITA, Anthropic, Slack, Resend). Most of the app's own request handling should stay well under 10 ms. The parts most likely to push close
  to it are PDF template rendering and the RSA/PSS signing math in `src/modules/signing/`.
- **D1**: a free-tier daily cap on rows read and rows written per account, not per database. Past
  it, queries fail until midnight UTC. Watch this if expense ingestion or a large accountant pack
  export runs on a busy day.
- **Subrequests**: 50 external `fetch` calls and 1,000 Cloudflare-service calls (D1, R2, Browser
  Rendering) per single invocation, on Free. A finalize call chains several D1 statements plus,
  for a qualifying tax invoice, one ITA call. That is not close to 50 in the normal flow, but keep
  it in mind if a future run adds more chained calls per request.

- **Cron triggers**: 10 ms of CPU per cron run on Free. The daily Drive import, recurring
  documents and the monthly accountant pack need more.
- **Browser Rendering**: 10 minutes a day on Free, so PDF rendering fails with a 429 on a busy
  day. Paid includes 10 hours a month.
- **D1 time travel**: 7 days of point-in-time recovery on Free, 30 days on Paid.

Upgrade in the Cloudflare dashboard: **Workers & Pages** > **Plans**. Paid includes 30 million CPU
milliseconds a month and allows 30 seconds of CPU per request by default.

## D1 time-travel: test and restore procedure

D1's own point-in-time recovery is separate from, and in addition to, R14's own quarterly export
and restore test (`src/modules/ops/backup.ts`, `docs/legal-requirements.md` instruction 25(ו)).
The quarterly job proves a specific export is restorable in memory; D1 time-travel restores the
*whole live database* to any point within roughly the last 30 days, for a mistake the quarterly
export would not catch (a bad migration, a bug that corrupted rows since the last quarter start).
Confirm it actually works on this database at least once, before you need it for real:

**Your computer**, once authenticated (`npx wrangler login`):

1. Note a bookmark to test against. Either grab the current one:
   ```
   npx wrangler d1 time-travel info DB --remote
   ```
   or pick a timestamp instead (D1 keeps 7 days of history on Free and 30 days on
   Paid): `--timestamp="2026-10-01T00:00:00Z"`.
2. **This step is destructive on the live database: only run it against a throwaway copy, never
   directly against the production `DB` binding, unless you are deliberately recovering from a
   real incident.** Create a temporary D1 database for the drill (**D1 SQL database** > **Create
   Database**, a name like `open-ledger-il-restore-drill`), export the real `DB`'s current state into
   it (`npx wrangler d1 export DB --remote --output=drill.sql` then
   `npx wrangler d1 execute open-ledger-il-restore-drill --remote --file=drill.sql`), and time-travel
   *that* copy:
   ```
   npx wrangler d1 time-travel restore open-ledger-il-restore-drill --remote --bookmark=<bookmark-from-step-1>
   ```
3. Confirm the restored copy's row counts and its `finalizations` table's last hash match what you
   expected for that point in time. Delete the throwaway database once satisfied.
4. For a real incident (not a drill): stop the Worker from taking further writes first (Cloudflare
   dashboard, disable the route, or pause the Custom Domain), then run the same
   `d1 time-travel restore` command against the real `DB` binding's id, confirm the restored state,
   then re-enable the Worker. Time-travel restores in place; it does not create a new database.

## Tax Authority relay (allocation numbers)

The Tax Authority refuses some calls that come from outside Israel. A Worker runs in whichever
Cloudflare data center takes the request, and Israeli users are often served from Frankfurt. On
6 October 2026 the token call from Frankfurt got a bare HTTP 403 and the same call from Tel Aviv
worked. Check where you are served from at `https://<your ledger address>/cdn-cgi/trace`, the
`colo=` line.

Placement hints do not fix it. A Worker with `placement.region = "gcp:me-west1"` ran in Mumbai
(BOM), and the Tax Authority refused that too.

The fix is a small relay on a server with an Israeli address. With `ITA_RELAY_URL`,
`ITA_RELAY_CLIENT_ID` and `ITA_RELAY_CLIENT_SECRET` set (docs/secrets.md), the Worker sends its
Tax Authority calls there. Only the server-side calls move: the token exchange, the access token
renewal and the invoice calls. The sign-in page opens in your own browser as before. Without the
three secrets the Worker calls the Tax Authority directly.

The relay ships in `tools/ita-relay`, with its setup steps in
`tools/ita-relay/README.md`. Any Linux server with an Israeli address works,
for example Oracle Cloud's Always Free tier in the Israel Central (Jerusalem) region.
The server reaches Cloudflare through a tunnel, behind an Access service token.

Why not the browser for all of it: the Tax Authority's API does not accept calls from a web page
on another address (no CORS), and the token calls carry the app's client secret, which must
never reach a browser.

On the ITA screen, Check route tries both routes with a fake token. "Reached the ITA" with any
HTTP status means the address was accepted. "Turned away, HTTP 403" means it was not.

Without a relay you can still issue invoices above the threshold: request the allocation number
in the Tax Authority's web app and enter it on the ITA screen.

### How long a login lasts

An ITA login lasts 90 days from the sign-in with your user code and one-time code. The Ledger
does not renew it every night. The access token, valid for minutes, is renewed when a call needs
it. Slack reminders go out on days 75, 85 and 89, the ITA screen shows a banner from day 80, and
on day 90 the connection is marked for reconnecting with one more message.

