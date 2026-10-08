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
nothing. Tokens pass through in memory and are never logged. Its own
refusals use the key `broker_error`.

## Set it up

1. Register the ITA API app in the developer portal. Its redirect address is
   `<broker address>/callback`, for example
   `https://ita-auth.example.com/callback`.
2. Deploy this folder as a Worker named `ita-auth`, from this folder on your
   computer: `npx wrangler deploy`.
3. Attach your hostname: Workers & Pages > ita-auth > Settings > Domains &
   Routes > Add > Custom domain.
4. Add the secrets under Settings > Variables and Secrets, each as type
   Secret:

| Name | Value |
|---|---|
| `ITA_CLIENT_ID_PRODUCTION` | The app's client id |
| `ITA_CLIENT_SECRET_PRODUCTION` | The app's client secret |
| `STATE_SECRET` | 32 random bytes, base64: `openssl rand -base64 32` |
| `BROKER_CLIENTS` | The installs allowed to use the broker, see below |
| `ITA_RELAY_URL`, `ITA_RELAY_CLIENT_ID`, `ITA_RELAY_CLIENT_SECRET` | Optional. The Israeli relay (tools/ita-relay), since the Tax Authority turns some Cloudflare locations away |
| `ITA_CLIENT_ID_SANDBOX`, `ITA_CLIENT_SECRET_SANDBOX` | Optional. A sandbox app for testing |
| `PUBLIC_URL` | Optional, a plain variable. The broker's own address. Default: the address the request came in on |

The relay accepts only the service tokens on its own allowlist. Add the
broker's service token there, or give the broker the same one the Ledger uses.

## Add an install

1. Make a key for it: `openssl rand -base64 32`. Give the key to the
   install's owner, to set as `ITA_BROKER_KEY`. Do not keep a copy.
2. Hash the key: `node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "<the key>"`.
3. Add an entry to `BROKER_CLIENTS`, a JSON list:
   `[{"name":"acme","origin":"https://ledger.acme.example","key_sha256":"<the hash>"}]`.
   `origin` is the install's address. The broker sends the browser back only
   there.
4. The install sets `ITA_BROKER_URL` to the broker address,
   `ITA_BROKER_CLIENT` to the name and `ITA_BROKER_KEY` to the key, and
   leaves the ITA client id and secret unset.
5. On the install's ITA screen, Check route should show "Through the login
   broker: reached the ITA". A 400 there is expected: the check sends a fake
   token on purpose.

To cut an install off, remove its entry from `BROKER_CLIENTS`.

## Routes

| Route | Use |
|---|---|
| `GET /authorize?client=&environment=&state=` | Starts the sign-in |
| `GET /callback` | The Tax Authority's return address |
| `POST /token` | Code exchange and renewal. Headers `X-Ita-Broker-Client` and `X-Ita-Broker-Key` |
| `GET /health` | `{"ok":true}` |
