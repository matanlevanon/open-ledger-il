# open-ledger-site

The Worker that serves the product site. `scripts/build-site.py` builds the pages into `site/`,
and this Worker serves that folder through Workers Static Assets.

On top of the files it:

- answers the `www.` host and the workers.dev address with a 301 to `siteUrl`, so one host is
  indexed
- answers the GitHub Pages era paths with a 301: `/index.html` to `/`, `/he.html` to `/he/`, and
  `/docs/*` to the same file in the repository
- adds a Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy` and
  `Permissions-Policy` to every reply
- caches hashed assets for a year, other assets for a day and pages for 10 minutes
- sends a `Link` header with the hreflang alternates on the two home pages

Every address comes from `site.config.json` at the repository root. A fork changes that file and
deploys this folder unchanged. `wrangler.toml` holds no route or domain.

## Connect Workers Builds

In the Cloudflare dashboard: Workers & Pages > Create > Import a repository > your fork of
`open-ledger-il`. Then:

| Setting | Value |
|---|---|
| Root directory | `/` |
| Build command | `python3 scripts/build-site.py` |
| Deploy command | `npx wrangler deploy --config tools/site/wrangler.toml` |
| Build watch paths | `site/*`, `scripts/build-site.py`, `site.config.json`, `tools/site/*` |

Every push to `main` that touches those paths builds and deploys the site.

## Add the custom domain

Workers & Pages > open-ledger-site > Settings > Domains & Routes > Add > Custom domain, for
example `open-ledger.example.com`. Put the same address in `siteUrl` in `site.config.json`.

## Check it

1. Open the address. The English home page loads, and `/he/` the Hebrew one.
2. `curl -sI https://<your address>/index.html` answers `301` with `Location: https://<your address>/`.
3. `curl -sI https://<your address>/` shows `Content-Security-Policy` and the `Link` header.
4. `curl -sI https://open-ledger-site.<your subdomain>.workers.dev/` answers `301` to your address.

## Develop

From the repository root:

- `python3 scripts/build-site.py` builds the pages.
- `npm run test:site` runs the Worker tests.
- `npx wrangler dev --config tools/site/wrangler.toml` serves the site on your computer.
