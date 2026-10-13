# Contracts and work orders

Fill & Sign is built into the Ledger. No outside signing service. Each business keeps its own templates, contracts, services list and files.

## Templates

Settings > Contract templates. A template has a name, a kind (contract or work order), a text in English, a text in Hebrew, and a list of fields. Either text can be empty. With both, a contract in "English and Hebrew" prints the English text, then the Hebrew text.

The text uses a small, safe Markdown set: `#` headings, `**bold**`, `*italic*`, `-` and `1.` lists, `>` indented blocks, `| pipe |` tables, `---` rules. Nothing else passes, and no HTML. A field goes in as `{{field_key}}`. A field alone on its line prints as a block.

Field kinds:

| Kind | Filled by | Notes |
|---|---|---|
| From the client | The Ledger, from the client record | Name, tax ID, address, contact. Editable for one contract. The client record stays as it is |
| From the business | The Ledger, from the business and its brand | Name, legal name, tax ID, address, email, phone, website |
| Typed by you at send | You, on the new contract screen | Text, multi-line text, money with currency, date, number. A starting value is optional, and it can number itself: `WO-{YYYY}-{NNN}` gives WO-2026-001, then WO-2026-002, the next after the highest this business used in that field. `{YY}` and `{MM}` work too. A new year starts at 1. You can type over it |
| Typed by the client | The client, on the signing page | Name, role, text, date |
| Signature | The owner or the client | The owner signs with the saved image from Settings > Signature |
| Date of signing | The Ledger, at signing | One per party |
| Choice | You, at send | Options, single or multiple, a free-text box per option, an Other box |

A choice field with "Use the services list" is the Work Order scope picker. Settings > Contract templates > Services holds the services and their scope items. On the new contract screen you tick services, then items under each, type Other and a note per service, and a fee per service. The PDF prints only what you ticked, as a list. `{{scope:fees}}` prints one fee line per ticked service.

Versions: while no sent contract uses a template, a save changes it in place. Once a sent contract uses it, a save makes the next version. The sent contract keeps its own version. Old versions are never deleted.

A sent contract stores a copy of every value, including the service names and items. A later change to the client, the business, the template or the services list never changes it.

Every business starts with two neutral templates:

- **Service Agreement** (contract). The standing terms. It governs the whole relationship and stays in force between projects.
- **Work Order** (work order). One per project: a number that fills itself (`WO-{YYYY}-{NNN}`), the date the Service Agreement was signed, the scope and the fee.

Both are templates in plain wording, with no governing-law clause. Have a lawyer review them before use, and change them to fit your business. The Ledger gives no legal advice.

## Send

1. Open the client, Contracts, New contract or work order.
2. Pick the template and the language. Check the fields. The preview is the same HTML the PDF uses, with the fields in blue boxes.
3. Add the signer at the client: name, email, optional phone. Pick how long the link lasts: 7, 14 or 30 days.
4. Optional, owner only: Sign as you when sending. The saved signature goes into your signature field.
5. Send for signing. The Ledger renders the PDF, adds the fields, stores it once at `business/<id>/contracts/<sha256>.pdf`, and emails the link when email is set up. Without email, copy the link or share it on WhatsApp.

Remind sends the same link again. Every reminder is logged. Void stops an unsigned contract and keeps it on record.

## Terms and work order together

For a first engagement, send the Service Agreement and the Work Order as one PDF. The client signs once.

1. New contract, pick a work order template.
2. Tick "Include the Service Agreement (first engagement)". The picker next to it starts on the template named Service Agreement (or Standard Terms), else the first contract template. Pick another one if you need to.
3. Fill the fields. The form shows the fields of both templates. A field key used in both is one field, and the work order's label and settings win.
4. The terms date field of the work order goes away from the form, with the line "Filled with the signing date". The Ledger fills it with the client's signing date, in Israel time.

The PDF prints the Service Agreement first, then the Work Order from a new page. With English and Hebrew, each part prints its English and then its Hebrew. There is one link, one signing and one evidence page. The evidence page names both templates and their versions, and so does the "Signed by" event.

The client's one signature goes into every client signature box of both parts. Your saved signature goes into every owner signature box. Before signing, every client box shows a Sign button, in the PDF and in the web view.

Once sent, both template versions are locked. Editing either template writes a new version, and the sent contract keeps the ones it was sent with. The client's Contracts tab and the contract page show the combined name, for example "Work Order + Service Agreement".

A work order template marks its terms date field with the role `terms_date`. The neutral Work Order marks `terms_signed_date`. Businesses set up before this change get the role on their work order templates the first time Contract templates opens, as a new template version when a sent contract already uses the current one.

Create pro forma works the same on a combined work order. It reads the work order's fields only.

## The PDF fields

Every filled value and every signature sits in a named PDF form field, so other PDF readers show them as fields. Field names are the template keys. A ticked scope item is a field named `<key>_<service>_<item>`.

How the positions are found: the renderer wraps each field in a link to `https://field.ledger.invalid/<name>`. Chrome writes each link into the PDF with its exact page and rectangle. The Ledger reads those rectangles, removes the links, and puts a form field in each one. No second measuring pass, and page breaks are handled by the real layout.

The text on the page comes from the HTML render, which lays out Hebrew right to left. The form field holds the same value as text and draws nothing over it. pdf-lib never draws Hebrew.

In the sent PDF, the values you filled are locked. In the signed PDF, every field is locked.

## The signing page

The client opens the link on a phone or a computer. No account, no app. English or Hebrew, with a switch on the page.

- The page shows the PDF and a download. Until it is signed, the PDF the client views or downloads has a blue Sign button in the client's signature box, linked back to the signature step of this page. The button is added on the fly. The stored sent PDF and the signed PDF never carry it.
- The client types the details the template asks for.
- With email set up, the client asks for a 6-digit code by email. It works for 15 minutes. A new code waits a minute after the last one, and earlier codes keep working until they expire, because emails can arrive late or out of order. 5 wrong tries lock every open code, and then the client asks for a new one. Without email, there is no code, and the evidence page says "Identity confirmed by link only".
- The client draws or types a signature. Typed signatures use Dancing Script, with Amatic SC for Hebrew letters. Both fonts are under the SIL Open Font License and ship with the Ledger.
- The client ticks the consent box and signs, or declines with an optional reason.

The link works only while its signature, its end date and the contract row agree. A signed, declined, void or ended contract shows a page that says so.

## What the signed PDF holds

- Both signatures in their signature fields.
- Every field locked, the values drawn on the page.
- An evidence page at the end: every event with its time, who acted, the IP address and the device, the hash of the sent PDF, the signed content hash, the template name and version, and how the signer was identified.
- The Ledger's certificate signature over the whole file, as a certifying signature that permits no change. A PDF reader shows any later change as breaking it.

The signed content hash covers the hash of the sent PDF, what the signer typed, the signature image and the time. The hash of the whole signed file is kept in the Ledger, on the contract record and in the events.

The sent PDF stays stored next to the signed one. Both are write-once.

## What the evidence proves

The record shows that the PDF the client signed is the PDF you sent, when the link was opened, from which IP address and device, that the person who signed held the signer's email at that moment when the code step ran, and that nothing changed in the file after signing.

It does not prove who held the phone or the computer.

## Legal weight

This is a simple electronic signature with an evidence trail, under Israel's Electronic Signature Law, 2001. It is not a certified or secure electronic signature in the sense of that law. Some transactions do not accept a simple electronic signature. Check with a lawyer before you rely on it for a contract that matters.

## Work order to pro forma

On a signed work order, Create pro forma opens a draft 300 for the same client. Fields the template marks as feeding the pro forma fill it: one line per ticked service with its fee, or one line per money field, the currency, and the start date in the notes. The contract links to the draft. Nothing is finalized. You check the draft and finalize it in the normal editor.

## Who does what

| | Owner | Assistant | Accountant |
|---|---|---|---|
| Templates and services | Yes | View | No |
| Create, send, remind, void | Yes | Yes | No |
| Sign as the business | Yes | No | No |
| View contracts | Yes | Yes | Signed only, with the Signed contracts switch on |

Every accountant view is written to `audit_log`.

## Alerts

The dashboard shows a line for a contract sent and not signed after 7 days, and for a link that ends within 2 days. The 07:00 cron marks ended links as expired and sends one Slack line per contract at 7 days. Slack also gets a line when a contract is signed or declined.

## Contracts signed elsewhere

A contract signed on paper or in another system is filed under its client with the signed PDF. On the client's Contracts tab, Add a signed contract opens the form:

- client, title, kind (contract or work order), signed date
- signer name, role and email
- optional start date, end date, fee with currency, and notes
- the signed PDF, up to 20 MB

The file must start as a PDF. The Ledger checks its first bytes, not its name. The same PDF twice is refused.

What the Ledger does:

- Stores the PDF write-once at `business/<id>/contracts/<sha256>.pdf`.
- Creates the contract as signed, with `origin = external`. No link, no code, no signing.
- Logs an `uploaded` event with who, when and the sha256, and a `contract.upload` audit row.
- Points the row at a hidden template of origin `external` for its kind, made on first use. This template never shows in Contract templates and never makes a Ledger contract.

After upload the contract never changes. The database triggers refuse any change to its values, PDF, hash, signer or dates. Void keeps it on record with its PDF, the same as any voided contract. No pro forma comes from it. Make the pro forma in the editor.

The list and the contract page say "Signed outside the Ledger" in place of the evidence trail. The Overview shows what was entered. The PDF opens and downloads as usual. An accountant sees it under the same rule as a signed Ledger contract: the Signed contracts switch on, every view audited. Owner and assistant upload.

## Automatic reminders

The 07:00 cron emails the signer of a sent contract the same signing link, through the Remind path, so the contract records a `reminded` event. Settings > Email > Reminders sets the rules:

- On or off. On by default.
- Remind after N days without signing. Default 3 and 7.
- One reminder 2 days before the link ends. On by default.

Each rule fires once per contract. One email covers every rule due the same day. Every reminder writes a row to `reminder_log` with the rule and the result, and the run dedupes on it.

The run skips:

- signed, void, declined and expired contracts
- contracts signed outside the Ledger
- clients with automatic reminders off (`docs/clients.md`)
- every contract while email is off

With email off, a due reminder for a signer with a phone shows on the dashboard under "Reminders due on WhatsApp today". Share on WhatsApp opens the prefilled message with the link and logs it. Remind on the contract page works as before, for every client.
