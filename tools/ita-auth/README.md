# ita-auth

A login broker for Open Ledger IL installs that share one ITA API app. The
app's client secret lives only in this Worker. Each install signs in and
renews its tokens through it, and sends its invoices straight to the Tax
Authority with its own access token.

Use it when you set up the Ledger for several businesses on one approved ITA
app. A business that registers its own app does not need it: give that
install its own ITA client id and secret instead (docs/deploy.md).

## How a sign-in works

1. The owner clicks Connect on the install's ITA screen. The install sends
   the browser to `/authorize` here, with its client name, the environment and
   its own one-time state.
2. The broker sends the browser to the Tax Authority sign-in, with the app's
   client id and `<broker address>/callback` as the return address. Its state
   is signed and expires after 15 minutes.
3. The Tax Authority returns to `/callback`. The broker checks the signature
   and sends the browser to `<install origin>/api/ita/callback` with the code
   and the install's own state.
4. The install calls `POST /token` with its name and key. The broker adds the
   client credentials and its return address, calls the Tax Authority token
   address, and hands back the reply as it came.

Renewals take step 4 only, with `grant_type=refresh_token`. The broker stores
only its client list. Tokens pass through in memory and are never logged. Its own
refusals use the key `broker_error`.

## Set it up

1. Register the ITA API app in the developer portal. Its redirect address is
   `<broker address>/callback`, for example
   `https://ita-auth.example.com/callback`.
2. Deploy this folder as a Worker named `ita-auth`, from this folder on your
   computer: `npx wrangler deploy`. Or connect the Worker to your fork so a
   push deploys it: Settings > Build > Connect, root directory
   `/tools/ita-auth`, no build command, deploy command `npx wrangler deploy`,
   include path `tools/ita-auth/*`.
3. Attach your hostname: Workers & Pages > ita-auth > Settings > Domains &
   Routes > Add > Custom domain.
4. Add the secrets under Settings > Variables and Secrets, each as type
   Secret:

| Name | Value |
|---|---|
| `ITA_CLIENT_ID_PRODUCTION` | The app's client id |
| `ITA_CLIENT_SECRET_PRODUCTION` | The app's client secret |
| `STATE_SECRET` | 32 random bytes, base64: `openssl rand -base64 32` |
| `REGISTER_SECRET` | 32 random bytes, base64. The installer sends it to add an install |
| `ADMIN_EMAILS` | The emails allowed on the admin page, comma separated |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | The Access app in front of `/admin`, see below |
| `ITA_RELAY_URL`, `ITA_RELAY_CLIENT_ID`, `ITA_RELAY_CLIENT_SECRET` | Optional. The Israeli relay (tools/ita-relay), since the Tax Authority turns some Cloudflare locations away |
| `ITA_CLIENT_ID_SANDBOX`, `ITA_CLIENT_SECRET_SANDBOX` | Optional. A sandbox app for testing |
| `PUBLIC_URL` | Optional, a plain variable. The broker's own address. Default: the address the request came in on |

The relay accepts only the service tokens on its own allowlist. Add the
broker's service token there, or give the broker the same one the Ledger uses.

## The client list

The installs allowed to use the broker live in a D1 database, bound as `DB`.

1. Create it once: Storage & Databases > D1 > Create, named `ita-auth-clients`.
   Put its id in `wrangler.toml`.
2. Run `migrations/0001_clients.sql` once, in the database's Console tab.

### Adding an install

The installer does this. It calls `POST /register` with `REGISTER_SECRET`
and the install's address. The broker makes a key, keeps only its hash,
and returns the name and key once. The installer stores them in the install
as `ITA_BROKER_CLIENT` and `ITA_BROKER_KEY`. Nobody sees or types the key.
Running the installer again for the same address gives that install a new key.

### Pausing an install

Open `<broker address>/admin`. It lists every install with its business,
address, date added and last use. Pause blocks the install at once and keeps
its row. Resume brings it back with the same key. Every change is kept in the
`client_events` table. The page never deletes a row.

Put the page behind Cloudflare Access: Zero Trust > Access > Applications >
Add > Self-hosted, domain `<broker host>/admin`, a policy that allows your
email only. Copy the application's audience tag to `ACCESS_AUD`, your team
address (`https://<team>.cloudflareaccess.com`) to `ACCESS_TEAM_DOMAIN`, and
your email to `ADMIN_EMAILS`. The broker checks the Access token itself too,
so the page stays closed if the Access app is ever removed.

## Routes

| Route | Use |
|---|---|
| `GET /authorize?client=&environment=&state=` | Starts the sign-in |
| `GET /callback` | The Tax Authority's return address |
| `POST /token` | Code exchange and renewal. Headers `X-Ita-Broker-Client` and `X-Ita-Broker-Key` |
| `POST /register` | Adds an install. Header `X-Ita-Broker-Admin`, JSON `{ origin, business }` |
| `GET /admin` | The client list, with Pause and Resume |
| `GET /health` | `{"ok":true}` |
