# Pricing and setup options

Pricing

## Free from source, installed by you, or set up for you

### Free from source

Free

- No license fee, no usage limits
- You register your own ITA API app
- Step-by-step setup guide

[Read the setup guide](https://github.com/matanlevanon/open-ledger-il/blob/main/docs/deploy.md)

Launch release: 50% off for a limited time

### Install it yourself, connected

₪199 ₪99 one time

- A Windows installer sets it up in your own Cloudflare account
- Tax Authority connection through MTN, no ITA app of your own
- One licence key for one business

[Buy and install](https://get.open-ledger.dev/buy)

Launch release: 30% off for a limited time

### Set up for you

₪999 ₪699 one time

- We create every account for you, with your own emails
- Tax Authority: your own ITA API app, or the connection through MTN
- Handed over working, with full control to you
- No subscription. Paid invoicing software costs ₪700 to ₪1,200 a year

Book a call

## Key facts

- Open Ledger IL is registered with the Israel Tax Authority as software for a computerized accounting system, under certificate 281801.
- It runs on the owner’s own Cloudflare account, and the data stays in the owner’s own database.
- It is free for your own business under the FSL-1.1 licence.
- Having it set up for you costs ₪699, once, with no subscription. That is a launch price, 30% off the regular ₪999, for a limited time.
- It supports עוסק פטור and עוסק מורשה businesses.
- It requests allocation numbers (מספרי הקצאה) from the Tax Authority for the tax invoices that need them.
- The connected installer, which you run yourself, costs ₪99, once. That is a launch price, 50% off the regular ₪199, for a limited time.

How it works

## Three steps to your first document

You deploy your own copy. Nobody else runs it or holds your data.

1. **Deploy your copy** Create one D1 database and two R2 buckets, connect the Worker to your fork on GitHub, and add your domain. Every push to main deploys.
2. **Lock it down** Cloudflare Access signs you in with your own email. Add the secrets: the PDF signing key, the mail key, and ITA credentials when you are מורשה.
3. **Set up the business** Business profile, logo, signature and the starting number of each series, so numbering continues from your previous system.

`git clone https://github.com/matanlevanon/open-ledger-il.git`

Starts on the Workers Free plan. Setup takes an afternoon.

## What you need

It starts on free tiers.

| Requirement | Notes |
| --- | --- |
| **Cloudflare account** Required | Workers Free runs it: the Worker, D1, R2, Browser Rendering and 5 scheduled jobs. Workers Paid, from $5 a month, lifts the limits below. |
| **PDF signing key and certificate** Required | For the PAdES signature on every PDF. One command makes both, docs/deploy.md step 8. |
| **Node.js and Wrangler** Required | On your computer, to apply database migrations and set secrets. |
| **A domain on Cloudflare** Optional | Your own ledger address, for example ledger.example.com. Without one, it runs on the free workers.dev address. Email from your own address still needs a domain. |
| **Resend account** Optional | To email documents, reminders and the accountant pack. The free tier covers a small business. |
| **ITA API credentials** Optional | Only as עוסק מורשה, for allocation numbers on tax invoices. |
| **Anthropic API key** Optional | For Claude to read expenses and past documents. Pay per use, a few cents per document. |
| **Google Cloud service account** Optional | For the Drive expense import and backup copies. Free. |

Workers Paid and known limits

### When to move to Workers Paid.

The ledger uses 5 scheduled jobs, the most Workers Free allows. Free has three other limits worth knowing:

- Cron CPU: 10 ms per scheduled run on Free. Most jobs fit. The monthly accountant pack and the quarterly backup build files and are the ones likely to need Paid.
- Browser Rendering, which draws every PDF: 10 minutes a day on Free, 10 hours a month on Paid.
- D1 point-in-time recovery: 7 days on Free, 30 days on Paid. For legal books, 30 days is the one to have.

### What it will not do

- It is not tax or legal advice. Check your setup with your accountant before you issue a real document.
- One business per deployment.
- Israel only: the document types, VAT and ITA rules are Israeli.
- It records payments. It does not charge cards or collect money.
- The PCN874 export fills the allocation-number column. The other columns are a stub.
- You run it: updates, secrets and the Cloudflare bill are yours.

[Do you need to register the software with the Tax Authority?](https://open-ledger.dev/en/registration/)

Source: https://open-ledger.dev/en/pricing/
