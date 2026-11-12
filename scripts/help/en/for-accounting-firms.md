---
title: The Ledger for accounting firms
description: Run your clients' books in one Ledger. What the firm edition changes, who reaches what, signing keys, moving a client out, retention and the costs.
updated: 2026-11-12
published: true
nav: For accounting firms
order: 16
---

The firm edition runs many client businesses in one Ledger. Each client has its own numbers, hash chain, signing key, files and owner. The owners of two clients never see each other.

You choose it in the installer: on the **Extras** step, tick **Accounting firm: manage many client businesses**. It sets the Worker variable `LEDGER_EDITION` to `firm`. **Settings > Updates** shows the edition.

## What the firm edition changes

- **Any business type for any client.** A person has one עוסק file, so a Ledger for one person allows one. A firm runs many clients, so it adds any number of עוסק פטור, עוסק מורשה and companies.
- **A tax id once per Ledger.** Two businesses never share a tax id, in either edition.
- **Ledger admins.** Ledger-wide settings belong to admins only: adding a business, VAT rates, ceilings, exchange rates, backups, the gap check, Updates, the expense category defaults, the email inbox and MCP on or off.
- **The firm team.** Firm staff reach every client with one grant.
- **The Clients page.** One row per client: VAT due or ceiling use, the Tax Authority login, the certificate end date, open payment requests, expenses to review and the last activity. Open it from the business switcher.

## Who reaches what

| Person | Reaches | Set in |
|---|---|---|
| Ledger admin | Every business as owner, present and future, and the Ledger-wide settings | Settings > Firm team |
| Firm staff, assistant | Every business: clients, documents, sending, expenses. No Settings | Settings > Firm team |
| Firm staff, accountant | Every business, read only, with the feature switches you set | Settings > Firm team |
| Client owner | Their own business only | Settings > Users, in that business |

A client owner sees the firm team in their user list as **Firm team**, with no email. They cannot reach another client, the Ledger-wide settings, or a Ledger-wide MCP token. A grant on one business wins over the firm grant for that business.

The installer's owner email becomes the first admin. A Ledger always keeps one admin: the last one cannot be removed.

## One signing key per business

Each client signs its documents under its own name. When you add a business, the Ledger makes its key in your browser right away. A client with no key cannot send documents, and its dashboard says so. See [Digital signature](/en/help/digital-signature/).

## MCP tokens

A client owner makes a token for their own business only. A Ledger-wide token reaches every business, and only admins make one. See [Connect Claude](/en/help/connect-claude/).

## A client who leaves

A client who moves to a Ledger of their own takes everything with them:

1. In the firm's Ledger, open the client, then **Settings > Businesses > Export**. Each file builds on its own: `data.json`, the unified file and the documents of each year, expenses with receipts, contracts, and `manifest.json` with a SHA-256 of each file. No keys and no tokens.
2. The client installs their own Ledger with the normal installer.
3. In the new Ledger: **Settings > Numbering > Continue from another Ledger** reads `manifest.json` and continues each series from the next number. **Settings > Businesses > Import data from another Ledger** reads `data.json`. The Import page takes the unified file as history.
4. Back in the firm's Ledger, an admin clicks **Mark as moved out** and types the business name. It works only after an export with every file built.

A moved-out business is read-only: no drafts, numbers, sending, payments, Tax Authority calls, bank sync, recurring documents or reminders. The switcher lists it under **Moved out**.

## Retention

Nothing is ever deleted. The books of a moved-out client stay in the firm's Ledger for the retention period of instruction 25: 7 years from the end of the tax year, or 6 years from the return, the later. There is no delete button.

## The costs

The firm edition has two costs on Cloudflare:

- **Workers Paid.** The free plan gives 100,000 requests a day and 10 ms of CPU per request. Many clients need more, so the firm edition needs Workers Paid.
- **Cloudflare Access seats.** Access is free for 50 users. Each person who signs in is one seat: admins, firm staff and client owners. Above 50, Access is paid per seat.

A Ledger per client is also possible: each client gets their own install. Each Ledger uses 5 of the 250 cron triggers a paid Cloudflare account allows, so about 50 clients per account, each updated on its own.
