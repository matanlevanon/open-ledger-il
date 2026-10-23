# Bookkeeping on your own cloud: what Cloudflare is, and why it costs little

What it means to run your bookkeeping in your own cloud account, what Cloudflare Workers is, what costs money and what stays free.

Updated 2026-10-14

Most invoicing software runs on the servers of the company that sells it. You pay a subscription, and your data sits with that company. There is another way: run the software in a cloud account in your own name. This guide covers what that means, and why on Cloudflare it can cost very little.

## What Cloudflare Workers is

Cloudflare is an internet infrastructure company. Workers is its service for running code without a server: the code runs when someone calls it, and there is no computer to keep on, no operating system to update and no server backups to manage [1].

Around Workers sit the other services a bookkeeping system needs:

- **D1**: a database. Clients, documents and payments live here.
- **R2**: file storage. PDFs and backups live here.
- **Browser Rendering**: a browser in the cloud that draws PDFs [2].
- **Cloudflare Access**: sign-in with your email, with no passwords to manage.

## Why it costs little

These services are priced by use, and each has a free allowance [1]. A small business bookkeeping system starts on the free plan [5].

The free plan runs the Worker, D1, R2, Browser Rendering and 5 scheduled jobs [5]. Workers Paid starts at $5 a month [1].

## When to move to the paid plan

The free plan has limits worth knowing [5]:

- **CPU per scheduled run**: 10 ms on the free plan [1]. Most jobs fit. Jobs that build files, such as a monthly accountant pack or a quarterly backup, are the ones likely to need the paid plan.
- **Browser Rendering**: 10 minutes a day free, 10 hours a month on the paid plan [2].
- **D1 point-in-time recovery**: 7 days free, 30 days on the paid plan [3]. For legal books, 30 days is the one to have.

## Your data, with you

When the system runs in your account, the database and the files are in your name. No company sits in the middle that must stay in business for you to reach your books.

The bookkeeping instructions require keeping documents 7 years from the end of the tax year, or 6 years from filing the return, whichever is later, and a quarterly backup kept away from the system [4]. On your own cloud that is your job, so the software should do it for you: files locked for the retention period, and an automatic backup.

## Backup and restore

There are two kinds of protection, and you want both:

- **Point-in-time recovery**: D1 keeps a history of the database and lets you go back to a moment. How far back depends on the plan [3].
- **A backup away from the system**: the instructions require a quarterly backup, in the first week of the quarter, kept away from the system [4]. An export of the database to separate storage, and a copy in another service, meet that.

A backup is only worth something if you can restore from it. So the software should test a restore with every backup.

## What is yours to handle

Your own cloud gives you control, and control comes with responsibility:

- **Updates**: you decide when to move to a new version.
- **Secrets**: the signing key, the mail key and the Tax Authority credentials stay with you.
- **The bill**: past the free allowance, the Cloudflare charge is yours.

## What you need to start

A Cloudflare account, a PDF signing key and certificate, and Node.js with Wrangler on your computer to apply database migrations and set secrets [5]. A domain is optional. Without one, it runs on the free workers.dev address [5].

## How Open Ledger IL does it

Open Ledger IL is one Worker in your own Cloudflare account: D1 for data, R2 for files locked for the retention period, Browser Rendering for PDFs and Cloudflare Access for sign-in. It starts on Workers Free, and backs up every quarter to R2 and Google Drive with a restore test. Install it yourself with the deploy guide, or ask for it to be set up for you.

[Try the live demo](https://demo.open-ledger.dev) [See pricing and setup](https://open-ledger.dev/en/pricing/)

## Questions and answers

**Do I need a server?**

No. The code runs on Cloudflare Workers, and there is no computer to keep on or update.

**What costs money?**

The free plan runs the system. Workers Paid starts at $5 a month and lifts the limits.

**Who sees the data?**

The data sits in your own Cloudflare account. Signing in goes through Cloudflare Access with your email.

**Do I need a domain?**

Not necessarily. Without one, it runs on the free workers.dev address. To send email from your own address, you need a domain.

**What happens to the data if I stop using it?**

It stays in your Cloudflare account. You can export it, for example as a unified file for your accountant.

## Sources

1. [https://developers.cloudflare.com/workers/platform/pricing/](https://developers.cloudflare.com/workers/platform/pricing/)
2. [https://developers.cloudflare.com/browser-rendering/platform/pricing/](https://developers.cloudflare.com/browser-rendering/platform/pricing/)
3. [https://developers.cloudflare.com/d1/reference/time-travel/](https://developers.cloudflare.com/d1/reference/time-travel/)
4. [https://github.com/matanlevanon/open-ledger-il/blob/main/docs/legal-requirements.md](https://github.com/matanlevanon/open-ledger-il/blob/main/docs/legal-requirements.md)
5. [https://github.com/matanlevanon/open-ledger-il/blob/main/docs/deploy.md](https://github.com/matanlevanon/open-ledger-il/blob/main/docs/deploy.md)

Source: https://open-ledger.dev/en/guides/own-cloud-bookkeeping/
