# Business documents

Each business keeps its certificates in Settings > Business documents. The assistant and the
accountant open the same list from the sidebar, under Business documents.

| Type | Hebrew | Ends |
|---|---|---|
| VAT registration certificate | תעודת עוסק פטור / מורשה | No |
| Company registration certificate | תעודת התאגדות | No |
| Bookkeeping certificate | אישור ניהול ספרים | Yes |
| Withholding tax certificate | אישור ניכוי מס במקור | Yes |
| Bank account confirmation | אישור ניהול חשבון | No |
| Other | אחר | No |

## Upload

- PDF, JPG or PNG, up to 10 MB.
- The file is stored once in R2 at `business/<business_id>/documents/<sha256>.<ext>`. The bucket never overwrites.
- A new upload of the same type becomes the current one. The older one stays listed as Replaced. Nothing is deleted.
- With a document reader set up (Anthropic or Gemini, see Settings > Expenses), the Ledger reads the type, the names, the tax ID or company number and the dates. You check them and click Confirm. After Confirm the row is fixed. A correction is a new upload.
- The number is checked against the check digit and against the tax ID of the business. A mismatch shows a warning.
- Use these details fills Settings > Business with the name and number. You save. The Ledger never changes the business profile by itself.
- With Gemini on the free tier, Google may use uploaded content to improve its products, and human reviewers may read it ([terms](https://ai.google.dev/gemini-api/terms)). Certificates hold your ID number.

## View, download, share

- View opens the file in the browser. Download saves it. Each opening writes `audit_log`.
- Share makes a link that ends after 1, 7 or 30 days (default 7). Copy link, Send by email (needs `MAIL_API_KEY`) or Share on WhatsApp.
- Active share links lists every link that still opens, with its open count and Revoke.
- A shared link opens under `/api/sending/public/bd/`, inside the Access bypass you set up for `/api/sending/public` (`cloudflare-access.md`). No new Access rule. The signature, the end date and the link row all have to agree. A revoked or ended link shows "Link unavailable". Every opening writes `audit_log`.

## Expiry

For the bookkeeping and withholding certificates, the 07:00 cron opens one task and sends one Slack alert 30 days before the valid-until date. The dashboard shows a line from 30 days before until you upload the new one.

## Who does what

| | Owner | Assistant | Accountant |
|---|---|---|---|
| Upload, confirm | Yes | No | No |
| View, download | Yes | Yes | With the Business documents switch on |
| Share, revoke links | Yes | Yes | No |

The accountant switch is off by default. Turn it on in Accountant > Users.

## Add a business

Add business offers Upload a certificate first. The Ledger reads the name and number into the form. After you add the business, the file is saved to it as its VAT registration or company registration certificate.
