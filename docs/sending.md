# Sending and reminders

How the Ledger hands documents and reminders to clients. Contract signing reminders are in `docs/contracts.md`.

## Channels

- Email through Resend, with the signed client PDF attached. Needs `MAIL_API_KEY`. Consent gates the first digital document.
- WhatsApp through a share link. The Ledger builds the message and a `wa.me` link. The owner sends it from the phone. WhatsApp never sends on its own.

## Payment reminders

The 07:00 cron reminds clients about open payment requests and pro formas with a due date. Settings > Email > Reminders sets the rules, on the same keys as before R28:

- `sending.reminders_enabled`: on or off. On by default.
- `sending.reminder_before_days`: days before due. Default 3.
- `sending.reminder_after_days`: days after due. Default 3 and 10.

Each rule fires once per document, deduplicated through `send_log` as before. A client needs granted consent.

R28 adds:

- A client with automatic reminders off gets none (`docs/clients.md`).
- Every email reminder writes a row to `reminder_log`, rule `before_<N>` or `after_<N>`, result `sent` or `failed`.
- A client with a phone and no email, or any client while email is off, gets a WhatsApp reminder due instead. The row has channel `whatsapp_due` and result `due`, once per rule.

## The reminder log

`reminder_log` is append-only, one row per automatic reminder:

| Column | Holds |
|---|---|
| `business_id`, `client_id` | Whose reminder |
| `target_kind`, `target_id` | `document` or `contract`, and its id |
| `channel` | `email` or `whatsapp_due` |
| `rule` | `before_3`, `after_10`, `unsigned_3`, `ends_2` and so on |
| `result` | `sent`, `failed`, `due` or `shared` |
| `details` | JSON: the label, the address, an error |

Triggers refuse updates and deletes, and a client of another business. The client page lists the rows for that client.

## Reminders due on WhatsApp

The dashboard line "Reminders due on WhatsApp today" lists the `due` rows written today and not yet shared, one item per document or contract. Owner and assistant see it. Share on WhatsApp:

- For a payment reminder, opens the reminder text addressed to the client's phone.
- For a contract, opens the signing link through Remind, which logs a `reminded` event on the contract.
- Writes a `shared` row for each rule due on the item, so it leaves the list.

A contract signed, declined or voided after the run drops off the list.
