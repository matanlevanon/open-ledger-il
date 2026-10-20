# API for other apps

Connect Financy, Make, Zapier, n8n or your accountant's software to your Ledger with an API key, and what the API can and cannot do.

Updated 2026-10-20

The API lets another app read your Ledger: Financy matching bank charges, Make, Zapier or n8n moving data between apps, or your accountant's software. Each app gets its own key, and you can cut any one of them off at any time.

For Claude and other AI apps, use [MCP](https://open-ledger.dev/en/help/connect-claude/) instead.

## Create a key

1. Open **Settings > MCP and API**. Only an owner sees this tab.
2. Under **API for other apps**, click **Create key**.
3. Name it after the app, for example "Financy".
4. Pick **Read** or **Read and write**. Most apps need Read only.
5. Click **Create key**. The key shows once. Copy it now, then click **I copied it**.

Lost the key? Revoke it and create a new one.

## What to give the app

Three values, all on the same page:

- **API address**: `https://<your ledger>/v1`
- **Business ID**: the number next to it. The business tax number works too.
- **The key**: starts with `ol_live_`

## Read and write keys

- A **read** key reads the business details, clients, documents, PDFs, payments, expenses and suppliers.
- A **write** key can also create clients and draft documents: quotes, payment requests, transaction invoices and receipts.
- No key can ever issue, send, credit, cancel or delete a document. A draft from the API waits in the Ledger until you check it and issue it yourself.

## Revoke a key

**Settings > MCP and API**, the key's row, **Revoke**, confirm. The app that used it stops working at once. The MCP switch on the same page turns off MCP only, not the API.

## For developers

### Authentication

Every call carries two headers:

`Authorization: Bearer ol_live_... X-Business-Id: 1`

A missing, unknown or revoked key answers 401. A key used with another business answers 403.

### Paging and syncing

Lists answer `{ "data": ..., "nextCursor": "..." }`. Pass `cursor=<nextCursor>` for the next page, until `nextCursor` is `null`. `limit` is 1 to 200, 50 by default. Add `updatedSince=2026-10-01T00:00:00Z` to get only what changed since your last sync.

### Money and dates

Money is in minor units with a `currency` field: `11800` with `ILS` is ₪118.00. Dates are `YYYY-MM-DD`. Times are ISO in UTC. Ids are numbers.

### Errors

Every error is `{ "error": { "code": "...", "message": "..." } }` with 400, 401, 403, 404, 409, 422 or 429. A read key on a write call gets 403 `scope_required`.

### Rate limit

120 requests a minute per key. Past that, 429 with a `Retry-After` header in seconds.

### Idempotency

Send `Idempotency-Key: <any unique string>` on a POST. The same key and body within 24 hours returns the first answer and never makes a second draft. The same key with another body answers 409.

### Endpoints

Replace the key and the address with yours.

| Call | What it returns |
| --- | --- |
| `GET /v1/business` | Name, tax id, legal mode, currency, address |
| `GET /v1/clients` | Clients with their open balance. Filters `q`, `active` |
| `GET /v1/clients/{id}` | One client |
| `GET /v1/documents` | Documents with totals. Filters `type`, `status`, `from`, `to`, `clientId` |
| `GET /v1/documents/{id}` | One document with lines and payments |
| `GET /v1/documents/{id}/pdf` | The client copy PDF, final documents only |
| `GET /v1/payments` | Recorded payments. Filters `from`, `to` |
| `GET /v1/expenses` | Expenses. Filters `from`, `to`, `status` |
| `GET /v1/suppliers` | Suppliers |
| `POST /v1/clients` | Creates a client (write key) |
| `POST /v1/documents` | Creates a draft (write key) |

`curl https://ledger.example.com/v1/business -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1" curl "https://ledger.example.com/v1/clients?q=acme" -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1" curl https://ledger.example.com/v1/clients/12 -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1" curl "https://ledger.example.com/v1/documents?type=305,320&from=2026-10-01" -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1" curl https://ledger.example.com/v1/documents/40 -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1" curl https://ledger.example.com/v1/documents/40/pdf -o document.pdf -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1" curl "https://ledger.example.com/v1/payments?from=2026-10-01" -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1" curl "https://ledger.example.com/v1/expenses?status=new" -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1" curl https://ledger.example.com/v1/suppliers -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1" curl https://ledger.example.com/v1/clients -X POST -H "Authorization: Bearer ol_live_YOUR_WRITE_KEY" -H "X-Business-Id: 1" -H "Content-Type: application/json" -d "{\"nameEn\":\"Acme Ltd\",\"email\":\"billing@acme.example\"}" curl https://ledger.example.com/v1/documents -X POST -H "Authorization: Bearer ol_live_YOUR_WRITE_KEY" -H "X-Business-Id: 1" -H "Idempotency-Key: oct-retainer-12" -H "Content-Type: application/json" -d "{\"type\":\"PR\",\"clientId\":12,\"lines\":{\"description\":\"Retainer, October\",\"unitPriceMinor\":500000}}"`

On Windows, in PowerShell:

`Invoke-RestMethod https://ledger.example.com/v1/business -Headers @{ Authorization = "Bearer ol_live_YOUR_KEY"; "X-Business-Id" = "1" }`

The draft's answer carries `editUrl`, the Ledger page where you check and issue it.

### The full description

Your own Ledger publishes it, with every field and example, at `https://<your ledger>/v1/openapi.json`. It needs no key. Import it into Postman, Make or any OpenAPI tool.

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
- [Get your expenses into the Ledger](https://open-ledger.dev/en/help/expenses/)
- [Send documents by email, and keep them out of spam](https://open-ledger.dev/en/help/email/)
- [Connect Claude or another AI app (MCP)](https://open-ledger.dev/en/help/connect-claude/)
- [Add or change a key after the install](https://open-ledger.dev/en/help/keys-later/)
- [Updates and backups](https://open-ledger.dev/en/help/updates-backups/)
- [Common problems and how to fix them](https://open-ledger.dev/en/help/troubleshooting/)

Source: https://open-ledger.dev/en/help/api/
