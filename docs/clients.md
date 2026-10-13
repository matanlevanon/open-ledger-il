# Clients

How the client record shapes what the Ledger sends and prints. The client copy language is in `docs/currency-and-fx.md`.

## Automatic reminders (R28)

The client form has "Send automatic reminders to this client". The switch is on for every client, old and new.

- On: the 07:00 run sends payment reminders and contract signing reminders under the rules in Settings > Email > Reminders. See `docs/sending.md` and `docs/contracts.md`.
- Off: the client gets no automatic reminder of either kind. Remind on a document or a contract still works.
- Stored in `clients.auto_reminders`, 1 or 0.

The client page lists every automatic reminder for the client, from `reminder_log`: the date, the document or contract, the rule and the result.

## Default payment methods (R28)

The client form has "Default payment methods", one checkbox per active method in Settings > Payment methods. None are ticked at first.

A new payment request, pro forma, tax invoice or receipt for the client starts with exactly the ticked methods. The owner changes them per document as before.

The order of choice for a new document:

1. Methods sent with the request, such as ticks in the editor.
2. The client's default methods, active ones only. A method turned off since is skipped.
3. The methods on the client's last finalized document (`clients.payment_method_ids`).
4. The business default (`businesses.payment_method_ids`).

With no defaults, steps 3 and 4 apply as before R28.

In the editor:

- A new document applies the client's defaults when it opens.
- Switching the client re-applies the new client's defaults while the owner has not changed a tick.
- After the owner ticks or unticks a method, a client switch leaves the ticks alone.
- An existing draft keeps its ticks until its client changes.

Stored in `clients.default_payment_method_ids`, a JSON array of `payment_methods.id`, NULL when empty. Saving checks every id belongs to the business. A final document never changes when the client's defaults change.
