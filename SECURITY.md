# Security

## Report a vulnerability

Do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repository (**Security** > **Report a vulnerability**). Include the affected version or commit, the steps to reproduce, and the impact.

You get an acknowledgement within 7 days. Please give a fix time before public disclosure.

## Scope

In scope: the Worker API, authentication and role checks, the accountant boundaries, document immutability and numbering, signed download and share links, the PDF signing code, and secret handling.

Out of scope: your own Cloudflare, Google or ITA account configuration, and denial of service against your own deployment.

## How this project handles secrets

- Every secret lives in Worker secrets (`docs/secrets.md`). None lives in the repo or in logs.
- `wrangler.toml` holds placeholders only. Your fork keeps real values in the Cloudflare dashboard.
- `node scripts/leak-check.mjs` and gitleaks run in CI on every push and PR.
- Sandbox and production ITA credentials use separate names. A Worker variable picks one.

## If you run your own deployment

- Put the whole domain behind Cloudflare Access. Bypass only `/api/sending/public/` (`docs/cloudflare-access.md`).
- Rotate `SIGNING_KEY_PEM`, `ITA_TOKEN_KEY`, `DOWNLOAD_SIGN_KEY`, `SEND_LINK_KEY` and `MCP_TOKEN` if you suspect exposure.
- Turn on the R2 retention lock for the documents bucket (`docs/deploy.md`, step 2).
