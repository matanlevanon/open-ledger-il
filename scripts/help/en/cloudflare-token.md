---
title: Create the Cloudflare API token
description: The exact permission rows, account and zone settings for the installer's Cloudflare token, with and without a domain.
updated: 2026-10-17
published: true
nav: Cloudflare API token
order: 3
---

The token is a password with limited rights. It lets the installer create the Ledger in your Cloudflare account. You delete it after the install.

## Open the token page

1. Open dash.cloudflare.com/profile/api-tokens in a new tab. Keep the installer open.
2. Click **Create Token**.
3. Scroll to the bottom of the list of templates. Find **Custom token** and click **Get started**.
4. Token name: anything, for example `Ledger install`.

## Add the permission rows

Each row has three boxes: the type (**Account** or **Zone**), the permission, and the level (**Read** or **Edit**). The first row is there already. Click **+ Add more** for each next row.

Add these six rows:

1. Account | Workers Scripts | Edit
2. Account | D1 | Edit
3. Account | Workers R2 Storage | Edit
4. Account | Access: Apps and Policies | Edit
5. Account | Access: Organizations, Identity Providers, and Groups | Read
6. Account | Account Settings | Read

Only if your account has a domain, add three more:

1. Zone | Zone | Read
2. Zone | Workers Routes | Edit
3. Zone | DNS | Edit

How to tell if you have a domain: on dash.cloudflare.com, the **Domains** list (on older menus, **Websites**) shows it. A new account has none.

## Account and zone resources

1. Below the permissions, under **Account Resources**, choose **Include**, then the business's account.
2. **Zone Resources** shows up only after you add a Zone row. With a domain: **Include**, then **Specific zone**, then the domain the Ledger will use. Without a domain you added no Zone rows, so this part does not show. Skip it.
3. **Client IP Address Filtering** and **TTL**: leave empty.

## Create and copy

1. Click **Continue to summary**, then **Create Token**.
2. Click **Copy** next to the token. Cloudflare shows it once. If you lose it, create a new one the same way.
3. Paste it in the installer and click **Check token**.

## If Check token fails

- **A permission is missing:** the message names it. Edit the token on the token page, add the row, save, and click **Check token** again. The token value stays the same.
- **Wrong account:** the token's **Account Resources** points at a different account. Edit it and pick the right one.
- **Pasted with a space:** copy it again with the **Copy** button.
- **Zero Trust or R2 not on yet:** finish step 1 of the installer first.
