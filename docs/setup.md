# First-run setup

Do this once, after `docs/deploy.md` and before you issue a real document. Every step runs in the app, signed in as the owner.

## 1. Business profile

The first sign-in opens the setup screen. The app refuses to create any document until the required fields hold a value. The same form lives in **Settings** > **Business**.

| Field | Required | Printed on |
|---|---|---|
| Business name (English) | Yes | Every document header, emails, the PDF signature name |
| Business name (Hebrew) | Yes | Hebrew documents and filed copies |
| Tax ID | Yes | Every document header. Your ת"ז or ח.פ, 9 digits. The app checks the check digit |
| Address (English) | Yes | Every document header |
| Address (Hebrew), tagline, email, phone, website | No | The document header, when set |
| Bank details, payment instructions, payment links | No | Payment requests and pro forma invoices |

Nothing in the code names a business. All of this lives in the `business_profile` table.

The legal mode starts as עוסק פטור. When a receipt would take turnover past the ceiling, the app stops before finalize and offers the switch to עוסק מורשה. The switch is permanent and dated. Ask your accountant before you confirm.

## 2. Logo

**Settings** > **Business** > **Logo** > **Upload image**. PNG, JPEG, WebP or SVG, up to 2 MB. The file goes to R2. The PDF header and the app's top bar use the file. Without an upload, both show the neutral "Open Ledger IL" wordmark.

## 3. Signature

**Settings** > **Signature** > **Signature image** > **Upload image**. A transparent PNG works best. The image prints above the signer line on every issued document. Without an upload, documents print no signature image.

The signature image is separate from the digital signature. The digital signature (PAdES) uses `SIGNING_KEY_PEM` and `SIGNING_CERT_PEM` from `docs/secrets.md`. Make both with:

```
node scripts/make-signing-cert.mjs "Your Business Name"
```

Ask your accountant whether you need a certificate from a licensed authority instead of a self-managed key.

## 4. Numbering start

**Settings** > **Numbering** lists one series per document type. Each series starts at 1.

Coming from another system? Set each series to one more than the last number you issued there. Do this before you issue the first document in that series. A series locks its start number the moment the first document takes a number, and the app refuses any later change.

## 5. Rates, ceiling and VAT

**Settings** > **Tax** holds the פטור ceiling per year and the VAT rate by effective date. The app ships with the 2026 ceiling and the 18% VAT rate from 1 January 2025. Add next year's ceiling once the ITA publishes the figure. Never edit code for a new rate.

## 6. Expenses from Google Drive (optional)

Follow `docs/drive-expenses-setup.md`. Then, in **Settings** > **Expenses**:

- **Drive root folder.** Paste your folder id. The field starts empty. There is no default folder.
- **Index sheet title.** Default `Expense index YYYY-MM`. `YYYY-MM` stands for the month.
- **Index sheet headers.** Read from the sheet's header row. English headers: Status, Date, Supplier, Supplier tax ID, Document type, Before VAT, VAT, Total, Currency, Exchange rate, Rate date, Total ILS, Category, Fixed, Document number, File link, Notes. The Hebrew set (סטטוס, תאריך, ספק and the rest) works too.

## 7. Check before go-live

- Issue one receipt to yourself. Open the client copy and the filed copy. Check the header, the tax id, the logo and the signature.
- Check with your accountant: the document types you need, the legal mode, and the digital delivery rules.
