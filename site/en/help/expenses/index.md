# Get your expenses into the Ledger

Forward receipts by email, upload them, or import a month from Google Drive. Each one is read by AI and waits for your check.

Updated 2026-10-18

## Forward receipts by email

The easiest way for receipts that reach your inbox. Your Ledger has a private address. Everything forwarded there becomes an expense, read by AI and waiting for your check.

### Find your address

Open **Settings > Expenses > Email inbox**. The address looks like `expenses+r7k2m9x4qp@open-ledger.dev`. Click **Copy**. The installer sets it up. If the page says the inbox is not set up, run the installer again.

### Set it up in Gmail, once

1. In Gmail, click the gear, then **See all settings**, then the tab **Forwarding and POP/IMAP**.
2. Click **Add a forwarding address**, paste the address and confirm.
3. Gmail sends a confirmation email to that address, with a code or a link. It shows up in the Ledger under **Email inbox**. Type the code in Gmail and click **Verify**, or click **Open the confirmation link**.
4. Leave **Disable forwarding** selected. You forward only receipts, not all your mail.
5. In the Gmail search box, paste the search from the Ledger page, for example `has:attachment (invoice OR receipt OR חשבונית OR קבלה)`. Add your suppliers if you like: `from:(billing@supplier.com)`.
6. Click the search options icon, then **Create filter**. Tick **Forward it to**, pick the address, and click **Create filter**.

From now on, every matching email goes to the Ledger by itself. To send one by hand, forward it to the same address.

### Outlook

**Settings > Mail > Rules > Add new rule.** Condition: **Has attachment**, and words in the subject such as invoice or receipt. Action: **Forward to** the address.

### What happens to each email

- Each PDF, JPG, PNG, WebP or HEIC attachment becomes one expense. Small logo images are skipped.
- An email with no attachment becomes one expense from its text, marked "From email text, check the amount".
- The same file twice is one expense.
- Only email forwarded from your own addresses counts. The list is under **Allowed senders**, and starts with the owner and assistant emails. Anything else is ignored and listed under **Last received**.
- The address passes through MTN's email gateway, which stores nothing.
- Each forwarded file is read with your Gemini or Anthropic key. When a read fails, the expense still arrives, with the reason in its note: "Not read automatically: ...". Fill in the details by hand.

### Your own domain instead

With your own domain on Cloudflare, an address on it goes straight to your Ledger, with no gateway in between.

1. In the Cloudflare dashboard, open your domain, then **Email > Email Routing**. Turn it on and let Cloudflare add its DNS records.
2. **Routing rules > Create address**. Custom address, for example `receipts`. Action: **Send to a Worker**. Destination: your Ledger's Worker, `mtn-open-ledger`. Save.
3. Use that address in Gmail as above. The Gmail confirmation shows up under **Email inbox** the same way.

Settings shows no address for this route, since you picked it. The allowed senders and **Last received** work the same.

### A new address

If the address leaks or gets spam, click **Make a new address**. The old one stops at once. Update the Gmail filter with the new one.

## Upload

The quickest way.

1. Open **Expenses** and click **Upload expense**.
2. Pick the file: PDF, JPG or PNG. On a phone, take a photo of the paper receipt.
3. With a Gemini or Anthropic key set, the Ledger reads the supplier, date, amounts and VAT, and fills them in. Check them and save.
4. Without a key, type the details yourself.

To add a reading key after the install, see [Add or change a key](https://open-ledger.dev/en/help/keys-later/).

## A month from Google Drive

For receipts you keep in Google Drive. The Ledger reads them, it never writes to Drive.

### How the folder looks

One main folder for expenses. Inside it, one folder per month named `YYYY-MM`, with that month's receipts as PDF or image files.

For example:

- `Expenses`, the main folder
- `Expenses/2026-09`, with `hosting-invoice.pdf` and `software-receipt.png`
- `Expenses/2026-10`, with October's receipts

Files that sit directly in the main folder are not read. Subfolders inside a month folder are not read either.

### Connect it, once

1. Create a Google service account and its JSON key, and turn on the Drive and Sheets APIs. The steps are in `docs/drive-expenses-setup.md` on GitHub.
2. Give the Ledger the key as the secret `GOOGLE_SERVICE_ACCOUNT_JSON`, see [Add or change a key](https://open-ledger.dev/en/help/keys-later/).
3. In Drive, share the main folder with the service account's address, the `client_email` in the key, as **Viewer**. The month folders inherit the share.
4. In **Settings > Expenses**, paste the folder id, the part of the folder's address after `/folders/`, and click **Save folder**.
5. The Ledger checks the folder right after saving. Click **Check folder** any time to run it again. It shows the folder's name and the month folders it found, or the one thing to fix: no key, a key that does not work, or a folder Google does not find because it is not shared with the service account.

### Or: a folder shared by link, with an API key

Shorter, with no service account. The catch: anyone who gets the folder's link reads every receipt in it, with names, addresses and amounts.

1. In console.cloud.google.com, pick or create a project. Open **APIs & Services > Library** and turn on **Google Drive API**, and **Google Sheets API** if you keep an index sheet.
2. **APIs & Services > Credentials > Create credentials > API key.** Under **API restrictions**, allow only those two APIs.
3. In Drive, open the main folder's **Share** dialog. Under **General access**, pick **Anyone with the link**, as **Viewer**.
4. Give the Ledger the key as the secret `GOOGLE_API_KEY`, see [Add or change a key](https://open-ledger.dev/en/help/keys-later/).
5. Save the folder id in **Settings > Expenses**. **Check folder** confirms it reads the folder by link.

When both keys are set, the service account is used. The quarterly backup copy to Drive writes files, so it needs the service account.

### Import

In **Expenses**, pick the month and click **Import month**. Each file is read with AI and waits for your check. Running it twice adds nothing twice. To import every morning, turn on **Daily sync** in **Settings > Expenses**.

### An index sheet, if you keep one

Optional. Some people keep a monthly spreadsheet of their expenses. When the month has one, the Ledger takes the rows from it instead of reading each file with AI.

- One Google Sheet per month, in the main folder, titled `Expense index YYYY-MM`, for example `Expense index 2026-10`. Change the title pattern in **Settings > Expenses**.
- **Download a sample sheet** in **Settings > Expenses** gives a CSV with every column and three sample rows. Open it in Google Sheets and choose **File > Save as Google Sheets**.
- The first row with a **Status** cell is the header row. Headers in English or Hebrew both work.

| Column | Required | What goes in it |
| --- | --- | --- |
| Status | Yes | Expense to import the row. Not an expense, Personal document, Not obtained, Rejected not business or Rejected income to skip it. |
| Date | Yes | `2026-10-02` or `2/10/2026` |
| Supplier | Yes | The supplier's name |
| Total | Yes | Total including VAT, for example `118.00` |
| Currency | Yes | ILS, USD, EUR or GBP |
| VAT | No | The VAT part of the total |
| Supplier tax ID, Document type, Document number | No | As printed on the document |
| Category, Fixed, Notes | No | Your own labels. Fixed is Fixed or Not fixed. |
| File link | No | The Drive link to the receipt. The Ledger attaches that file to the expense. |

Rows with any other status, such as a totals row, are ignored.

Still stuck? [Write to us from the pricing page.](https://open-ledger.dev/en/pricing/#setup)

## More help

- [Before you install: what you need](https://open-ledger.dev/en/help/before-you-start/)
- [Install Open Ledger IL step by step](https://open-ledger.dev/en/help/install/)
- [Create the Cloudflare API token](https://open-ledger.dev/en/help/cloudflare-token/)
- [First sign-in and setup](https://open-ledger.dev/en/help/first-sign-in/)
- [Give your accountant or assistant access](https://open-ledger.dev/en/help/users/)
- [Connect to the Tax Authority for allocation numbers](https://open-ledger.dev/en/help/tax-authority/)
- [From quote to receipt: your first documents](https://open-ledger.dev/en/help/first-invoice/)
- [Digital signatures: what the Tax Authority requires and how the Ledger meets each rule](https://open-ledger.dev/en/help/digital-signature/)
- [Take payments with Grow, Cardcom or another provider](https://open-ledger.dev/en/help/payment-providers/)
- [Send documents by email, and keep them out of spam](https://open-ledger.dev/en/help/email/)
- [Connect Claude or another AI app (MCP)](https://open-ledger.dev/en/help/connect-claude/)
- [Add or change a key after the install](https://open-ledger.dev/en/help/keys-later/)
- [Updates and backups](https://open-ledger.dev/en/help/updates-backups/)
- [Common problems and how to fix them](https://open-ledger.dev/en/help/troubleshooting/)

Source: https://open-ledger.dev/en/help/expenses/
