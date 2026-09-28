# Cloudflare Access setup

Open Ledger IL never checks a password itself. Cloudflare Access sits in front of the whole
`ledger.example.com` domain. It only lets a signed-in, allow-listed person reach the Worker.
The Worker then reads the identity Access attaches to the request (`src/core/auth.ts`) and maps
the email to a role in the `users` table. This page is the one-time dashboard setup. Day to day,
you manage who has an account from the Accountant screen in the app itself.

## 1. Create the Access application

1. Cloudflare dashboard > your account > Zero Trust > Access > Applications > Add an application.
2. Choose **Self-hosted**.
3. Application name: `Open Ledger IL`.
4. Session duration: 24 hours. A session cookie expiring daily is enough. The app's own end-date
   check in `users.access_ends_on` is the real access-length control, not this setting.
5. Application domain: `ledger.example.com`, the whole domain, no path restriction. The
   Worker itself decides which routes an accountant may call.
6. Save. Copy the **Application Audience (AUD) tag** shown on the application's Overview tab.

## 2. Note the team domain

Zero Trust > Settings > Custom pages, or the URL bar while in Zero Trust, shows your team domain:
`https://<team-name>.cloudflareaccess.com`. You need both this and the AUD tag for step 4.

## 3. Add the policy

On the application, tab **Policies** > Add a policy.

- Policy name: `Open Ledger IL sign-in`.
- Action: **Allow**.
- Session duration: same as above.
- Include rule, one of:
  - **Emails**: your Google account's email (owner), plus the accountant's email once you invite
    them in the app.
  - Identity provider: if you connect Google as a login method, you can instead scope by
    **Login Methods > Google** combined with an **Emails** include rule, so only the listed
    addresses pass, not every Google account.
- Authentication method for the accountant: either **One-time PIN** (Access emails them a code
  each sign-in, no separate account needed) or their own **Google** account, if you added Google
  as a login method under Zero Trust > Settings > Authentication.

Save the policy.

## Second application: public client links (Bypass)

Clients open two links without a Cloudflare Access session: the consent page and the WhatsApp PDF
share link, both under `/api/sending/public/` (`src/modules/sending/public-paths.ts`). With Access
on the whole domain, clients hit a sign-in wall. Add a second, more specific application:

1. **Add an application** > **Self-hosted**. Name it "Open Ledger IL public links".
2. Domain `ledger.example.com`, path `api/sending/public`.
3. Policy: name "Public client links", action **Bypass**, include **Everyone**. Save.

Access applies the most specific path first, so only these links skip sign-in. Each one still
carries a signed token that the Worker verifies inside the route.

## 4. Wire the Worker to this application

In the Cloudflare dashboard, Workers > `open-ledger-il` > Settings > Variables:

- `ACCESS_TEAM_DOMAIN` = `https://<team-name>.cloudflareaccess.com`
- `ACCESS_AUD` = the Application Audience tag from step 1

Both are plain variables (`[vars]` in `wrangler.toml`), not secrets. Neither is sensitive on its
own, without the other and without a live session. Leaving either empty makes the Worker refuse
every sign-in (see `authenticate()` in `src/core/auth.ts`). Treat a blank one as "no one can sign
in," not "open to everyone."

## 5. Inviting an accountant

Do this from the app, not the dashboard: sidebar Accountant > Invite accountant. The app writes
the `users` row, the feature switches and the end date. It reminds you 14 days before the end
date, then disables the account itself on that date. All you do on the Cloudflare side is add
their email to the policy's Include rule from step 3, so Access actually lets their sign-in
through.

## 6. Revoking an accountant

Revoke in the app first: sidebar Accountant > Revoke. That deletes their `users` row and the
feature switches at once and logs it. Then remove their email from the Access policy's Include
rule from step 3, so a stale login can never reach the Worker again, even if you later invite the
same person afresh. The app cannot edit the Access policy for you. There is no Access API call in
this stack. CLAUDE.md rule 5 keeps API tokens with that scope out of the Worker, so this one step
stays manual.

## 7. Checking it works

- Sign in as the owner from a private browser window. Access should prompt for your identity
  provider, then land on the app with `role: owner` in the top bar.
- Sign in as the accountant (One-time PIN, or their Google account) from a different browser or
  profile. They should land with `role: accountant` and only the sidebar sections their features
  allow.
- An email not in the policy's Include rule never reaches the Worker. Access shows its own
  "Access Denied" page before the request gets here.
