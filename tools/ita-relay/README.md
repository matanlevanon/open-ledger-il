# ita-relay

Forwards the Ledger's server-side calls to the Israel Tax Authority from a
server with a fixed Israeli address. You need it only for allocation numbers
(מספרי הקצאה), and only as a fallback.

Start with Option 1 in docs/deploy.md, "Reaching the Tax Authority": the
Worker calls the Tax Authority directly, and works whenever Cloudflare serves
you from Tel Aviv. Set up this relay when that keeps failing, or when you want
every call to succeed, including the scheduled retries.

## Why

The Ledger is a Cloudflare Worker. A Worker runs in whichever Cloudflare data
center takes the request. Israeli users are served from Tel Aviv some of the
time and from Frankfurt at other times. On 6 October 2026 the Tax Authority's
token endpoint answered calls from Frankfurt with a bare HTTP 403. On 7
October the same Worker was served from Tel Aviv and got through. Scheduled
jobs run in a data center Cloudflare picks, often outside Israel.
Cloudflare's placement hints did not help: a Worker placed "near Tel Aviv"
ran in Mumbai, which was refused too.

The sign-in page is not relayed. It opens in your own browser, from your own
connection. The relay carries only what the Worker sends: the token exchange,
the access token renewal and the invoice calls. Those carry the app's client
secret, so they cannot move to the browser.

Check first. On the ITA screen, click Check route a few times over a few
minutes. If Direct shows TLV and reached the ITA, Option 1 works for you.

## What it forwards

| Relay path | Goes to |
|---|---|
| `/openapi/shaam/<env>/...` | `https://openapi.taxes.gov.il/shaam/<env>/...` |
| `/ita-api/shaam/<env>/...` | `https://ita-api.taxes.gov.il/shaam/<env>/...` |

`<env>` is `tsandbox` or `production`. GET and POST only. Authorization,
Content-Type and Accept pass through, every other header is dropped, and
redirects are not followed. `GET /health` answers once the caller is verified.

Every request needs a verified Cloudflare Access service token. Bodies and
headers are never logged. The log shows method, path, status, size and time.

## What you need

- A Linux server with an Israeli IP address. Any VPS in Israel works.
  Oracle Cloud's Always Free tier is one option: pick **Israel Central
  (Jerusalem)** as the home region when you sign up (it cannot be changed
  later) and create an Ubuntu VM on an Always Free shape.
- Node 20 or newer on that server. No npm packages.
- A domain on your Cloudflare account, for the tunnel hostname.

No inbound port is opened. The server reaches Cloudflare through a tunnel.

## Setting it up

About 30 minutes. Each command says where it runs.

### 1. Confirm the address is Israeli

[server]

```
curl -s https://ipinfo.io/country
```

It must print `IL`.

### 2. Get the code

[server]

```
git clone --depth 1 https://github.com/<you>/open-ledger-il.git ~/open-ledger-il
```

```
node --version
```

Under v20, install a newer Node first.

### 3. The tunnel

Zero Trust dashboard, Networks, Tunnels, Create a tunnel, Cloudflared. Name it
`ita-relay`. Run the install command the dashboard shows, on the server. Then
add a Public Hostname:

- Subdomain `ita-relay`, your domain
- Service type HTTP, URL `localhost:8788`

### 4. The service token

Zero Trust dashboard, Access, Service auth, Service Tokens, Create Service
Token. Name it `ledger`, duration non-expiring or the longest offered.

Copy the Client ID and the Client Secret. The secret is shown once. The Client
ID goes into the server's env file and into the Ledger. The secret goes into
the Ledger only.

### 5. The Access application

Zero Trust dashboard, Access, Applications, Add an application, Self-hosted:

- Application name: ita-relay
- Public hostname: the one from step 3
- Policy: Action Service Auth, Include, Service Token, `ledger`

Copy the Application Audience (AUD) Tag. That is `CF_ACCESS_AUD`. Your team
domain is the `<team>.cloudflareaccess.com` name, shown under Zero Trust
Settings.

### 6. The env file

[server]

```
cp ~/open-ledger-il/tools/ita-relay/ita-relay.env.example ~/.ita-relay.env && chmod 600 ~/.ita-relay.env && nano ~/.ita-relay.env
```

Fill `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` and
`ITA_RELAY_ALLOWED_CLIENT_IDS` (the Client ID from step 4). Save with Ctrl+O,
Enter, then Ctrl+X.

### 7. Start it

The unit assumes the user `ubuntu`. Edit `systemd/ita-relay.service` first if
yours differs.

[server]

```
sudo cp ~/open-ledger-il/tools/ita-relay/systemd/ita-relay.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now ita-relay
```

```
tail -n 20 ~/ita-relay.log
```

The first line reads `ita-relay 0.1.0 listening on 127.0.0.1:8788`. A missing
value in the env file stops it with the variable's name. Errors go to
`journalctl -u ita-relay`.

### 8. The Ledger

Cloudflare dashboard, Workers & Pages, your Ledger Worker, Settings, Variables
and Secrets. Add three, type Secret:

- `ITA_RELAY_URL`: `https://ita-relay.<your domain>`
- `ITA_RELAY_CLIENT_ID`: the Client ID from step 4
- `ITA_RELAY_CLIENT_SECRET`: the Client Secret from step 4

### 9. Check it

On the ITA screen, click Check route. "Through the relay: reached the ITA" is
the goal. An HTTP 400 or 401 there is fine: the check sends a fake token on
purpose.

## Reading the log

| Line | Meaning |
|---|---|
| `refused 401` | no Access assertion, or one that did not verify. The request skipped Access, or the AUD is wrong |
| `refused 403: service token ... is not on the allowlist` | the Client ID in the env file does not match the token the Ledger sends |
| `refused 404` | a path outside the two Tax Authority hosts |
| `POST ita-api/shaam/... 403` | the Tax Authority refused the server too. The address is not Israeli enough, check step 1 |
| `upstream error` | the Tax Authority did not answer within 30 seconds |

## Updating

[server]

```
cd ~/open-ledger-il && git pull && sudo systemctl restart ita-relay
```
