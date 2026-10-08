# Secrets and configuration

Secrets live only in Worker secrets (CLAUDE.md rule 5). Never in the repo, never in logs, never in `audit_log`. `redact()` in `src/core/audit.ts` drops secret-looking keys from audit details.

Set a secret on your computer with `npx wrangler secret put <NAME>`, or in the Cloudflare dashboard under Workers, open-ledger-il, Settings, Variables and Secrets. Local development reads `.dev.vars`, which git ignores. Start from `.dev.vars.example`.

## Secrets

| Name | Used by | What it holds |
|---|---|---|
| `OWNER_TAX_ID` | R02, R12 | Owner ID number (ת"ז) printed on documents and sent to the ITA as `user_id` |
| `SIGNING_KEY_PEM` | R03 | PDF signing private key |
| `SIGNING_CERT_PEM` | R03 | PDF signing certificate |
| `ITA_CLIENT_ID_SANDBOX` | R12 | ITA sandbox client id |
| `ITA_CLIENT_SECRET_SANDBOX` | R12 | ITA sandbox client secret |
| `ITA_CLIENT_ID_PRODUCTION` | R12 | ITA production client id |
| `ITA_CLIENT_SECRET_PRODUCTION` | R12 | ITA production client secret |
| `ITA_TOKEN_KEY` | R12 | AES-GCM key for stored ITA tokens. 32 random bytes, base64. Make one on your computer with `openssl rand -base64 32` |
| `ITA_RELAY_URL` | R24 | Optional. A relay with an Israeli address for the Tax Authority calls, for a Worker served outside Israel (the Tax Authority answered Frankfurt with 403). Unset means direct calls |
| `ITA_RELAY_CLIENT_ID` | R24 | Cloudflare Access service token Client ID for the relay. Required with `ITA_RELAY_URL` |
| `ITA_RELAY_CLIENT_SECRET` | R24 | Cloudflare Access service token Client Secret for the relay. Required with `ITA_RELAY_URL` |
| `ITA_BROKER_URL` | ita-auth | Optional. A login broker (tools/ita-auth) that holds a shared ITA API app's client secret. Set, the install needs no ITA client id or secret of its own |
| `ITA_BROKER_CLIENT` | ita-auth | This install's name at the broker. Required with `ITA_BROKER_URL` |
| `ITA_BROKER_KEY` | ita-auth | This install's key at the broker. Required with `ITA_BROKER_URL` |
| `ITA_VAT_NUMBER` | R12 | Optional. Business VAT number (עוסק מורשה) sent to the ITA. Defaults to `OWNER_TAX_ID`, the same number for an individual |
| `ANTHROPIC_API_KEY` | R07, R17 | Expense extraction; also "Upload existing documents" (Import), reading fields from a previously-issued document. Unset: both screens fall back to manual entry |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | R07, R14, R20 | Drive ingest and backup. R20 reads the monthly index sheets too, so the key needs Drive API and Sheets API on its project. Setup: `docs/drive-expenses-setup.md` |
| `SLACK_WEBHOOK_URL` | R08, R09, R12, R14 | Alerts. R12 sends the 24-hour allocation alert and the day-75 ITA re-login reminder |
| `DOWNLOAD_SIGN_KEY` | R09 | HMAC key for signed, time-limited R2 download links |
| `MAIL_API_KEY` | R06, R08 | Outgoing email through Resend. R08 emails the monthly accountant pack |
| `SEND_LINK_KEY` | R06 | HMAC key for signed consent-request and WhatsApp share links. 32 random bytes, base64. Make one with `openssl rand -base64 32` |
| `MCP_TOKEN` | R14 | Bearer token for `/mcp` |

Sandbox and production ITA credentials sit under separate names. `ITA_ENV` picks the set (CLAUDE.md rule 7).

## Variables (not secret, in `wrangler.toml`)

| Name | Default | Meaning |
|---|---|---|
| `ENVIRONMENT` | `production` | Set to `development` in `.dev.vars`. The dev sign-in bypass is refused in production |
| `ITA_ENV` | `sandbox` | `sandbox` or `production` |
| `ACCESS_TEAM_DOMAIN` | empty | `https://<team>.cloudflareaccess.com`. Empty refuses every sign-in |
| `ACCESS_AUD` | empty | Audience tag of the Access application |
| `OWNER_EMAIL` | empty | First sign-in of this email creates the owner row while no owner exists |
| `DEV_AUTH_EMAIL` | unset | Local only. Signs in as this email without Access |
| `PUBLIC_APP_URL` | empty | Origin used to build consent and share links in emails. Empty falls back to the request origin |

## Bindings

| Binding | Type | Name |
|---|---|---|
| `DB` | D1 | `open-ledger-il`. The only D1 database. Replace the placeholder `database_id` at deploy |
| `FILES` | R2 | `open-ledger-il-files` |
| `BACKUPS` | R2 | `open-ledger-il-backups`. R14 quarterly backup exports and manifests, separate from `FILES` |
| `ASSETS` | Static Assets | `web/dist` |
| `BROWSER` | Browser Rendering | Used by R02 (`src/modules/pdf`) to render documents to PDF |
