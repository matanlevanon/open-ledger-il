# open-ledger-site

The Worker that serves the product site. `scripts/build-site.py` builds the pages into `site/`,
and this Worker serves that folder through Workers Static Assets.

On top of the files it:

- answers the `www.` host and the workers.dev address with a 301 to `siteUrl`, so one host is
  indexed
- answers every host in `legacyHosts` (and its `www.`) with a 301 to the same page on `siteUrl`,
  path and query kept. Hebrew moved from `/he/` to the root and English from the root to `/en/`,
  so `/he/...` goes to `/...` and every other path to `/en/...`. `robots.txt`, `sitemap.xml`,
  `llms.txt`, `llms-full.txt`, `favicon.svg` and `/assets/*` keep their path
- answers an old `/he/...` path on `siteUrl` itself with a 301 to its root form
- answers the GitHub Pages era paths with a 301: `/index.html` and `/he.html` to `/`, and
  `/docs/*` to the same file in the repository
- adds a Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy` and
  `Permissions-Policy` to every reply
- caches hashed assets for a year, other assets for a day and pages for 10 minutes
- sends a `Link` header with the hreflang alternates on the two home pages

Every address the pages use comes from `site.config.json` at the repository root. `wrangler.toml`
lists the official site's custom domains: `open-ledger.dev`, `www.open-ledger.dev` and the old
`open-ledger.matanlevanon.com`. A fork changes `siteUrl`, empties `legacyHosts`, and replaces
those routes with its own domain or deletes them.

The official Worker is named `open-ledger-il` in the dashboard. A manual deploy of it runs
`npx wrangler deploy --config tools/site/wrangler.toml --name open-ledger-il`.

## Connect Workers Builds

In the Cloudflare dashboard: Workers & Pages > Create > Import a repository > your fork of
`open-ledger-il`. Then:

| Setting | Value |
|---|---|
| Root directory | `/` |
| Build command | `python3 scripts/build-site.py` |
| Deploy command | `npx wrangler deploy --config tools/site/wrangler.toml` |
| Build watch paths | `site/*`, `scripts/build-site.py`, `scripts/site_build/*`, `scripts/guides/*`, `site.config.json`, `tools/site/*`, `CHANGELOG.md` |

Every push to `main` that touches those paths builds and deploys the site.

## Add the custom domain

A deploy adds the custom domains listed in `wrangler.toml`. To check, or to add one by hand:
Workers & Pages > your Worker > Settings > Domains & Routes > Add > Custom domain, for example
`open-ledger.example.com`. Put the same address in `siteUrl` in `site.config.json`.

## Check it

1. Open the address. The Hebrew home page loads, and `/en/` the English one.
2. `curl -sI https://<your address>/he/pricing/` answers `301` with `Location: https://<your address>/pricing/`.
3. `curl -sI https://<your address>/` shows `Content-Security-Policy` and the `Link` header.
4. `curl -sI https://open-ledger-site.<your subdomain>.workers.dev/` answers `301` to your address.

## After the move

The site used to be on GitHub Pages, from `/docs`. `docs/index.html` and `docs/he.html` are now
small redirect pages, written by the same build: a canonical link to the new address, a meta
refresh, a `location.replace` script and a visible link, all `noindex`. An old `#options` or
`#features` link lands on the page that took over that section.

1. Keep GitHub Pages on for 6 months, so old links and search results still land.
2. After that, turn it off: repository Settings > Pages > Source: None.
3. Point the repository About box website field at the new address.
4. Use the new address in GitHub release notes from now on.

## Search Console verification

Put the file name Google gives you in `site.config.json` under `searchVerification.googleFile`,
for example `google1234abcd.html`. The Worker answers that one path with the line Google expects,
without the redirect the static assets would add. A Domain property verified through DNS needs
no file: leave it empty.

## Analytics, off until set

`site.config.json` has two empty ids under `analytics`, so a fork sends nothing.

- `cfBeaconToken`: the token of a Cloudflare Web Analytics site. The pages load the beacon.
- `ga4Id`: a GA4 measurement id (`G-...`). The pages load GA4 with IP anonymised, no Google
  signals and no ad personalisation, and send two events: `setup_request` when the setup form
  is sent, and `demo_click` on every demo button.

The Worker's Content-Security-Policy allows each analytics host only when its id is set. Rebuild
and deploy after you set one.

## Develop

From the repository root:

- `python3 scripts/build-site.py` builds the pages.
- `npm run test:site` runs the Worker tests.
- `npx wrangler dev --config tools/site/wrangler.toml` serves the site on your computer.
