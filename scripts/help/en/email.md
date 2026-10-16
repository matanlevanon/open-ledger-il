---
title: Send documents by email, and keep them out of spam
description: Connect Resend so the Ledger emails receipts and invoices from your own domain, and the DNS and wording that keep them in the inbox.
updated: 2026-10-17
published: true
order: 10
---

The Ledger sends email through Resend, a sending service with a free plan. Resend sends only from a domain you own and verify. Without a domain, download each PDF or use the WhatsApp button on the document page.

## Set up Resend

1. Sign up at resend.com.
2. Open **Domains**, click **Add Domain**, and type your domain, for example `acme.co.il`.
3. Resend shows DNS records: one or two for DKIM, one for SPF, and one MX on a `send.` subdomain. Add them where the domain's DNS lives. On Cloudflare, Resend offers to add them for you.
4. Wait for **Verified**. Minutes, sometimes an hour.
5. Open **API Keys**, click **Create API Key**, pick **Sending access**, and copy the key. It starts with `re_`.
6. Give it to the Ledger in the installer's Extras step, or later as the secret `MAIL_API_KEY` plus the variable `MAIL_FROM`, see [Add or change a key](/help/keys-later/).

`MAIL_FROM` is the name and address clients see, for example `Acme Ltd <billing@acme.co.il>`. The address must be on the verified domain.

## Keep it out of spam

1. **DMARC.** Add a TXT record named `_dmarc` with the value `v=DMARC1; p=none;`. After two weeks of clean reports, change `p=none` to `p=quarantine`. Gmail and Yahoo expect a DMARC record from every sender.
2. **Turn off tracking.** In Resend, **Domains >** your domain **> Configuration**: turn off open tracking and click tracking. Tracking pixels and rewritten links push mail into Promotions and spam.
3. **A real reply address.** Send from an address that receives mail, such as `billing@` with a mailbox or forwarding behind it. Replies tell Gmail people want your mail.
4. **One sender for documents only.** Do not send newsletters from the address that sends receipts.
5. **Test once.** Send a receipt to your own Gmail, open it, click the three dots, **Show original**, and check that SPF, DKIM and DMARC all say **PASS**.

## The first email to a client

The Ledger asks for the client's consent before the first digital document. Ask the client to add your address to their contacts, and the next ones reach the inbox.
