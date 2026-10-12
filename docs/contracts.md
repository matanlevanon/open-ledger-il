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
| Typed by you at send | You, on the new contract screen | Text, multi-line text, money with currency, date, number. A starting value is optional |
| Typed by the client | The client, on the signing page | Name, role, text, date |
| Signature | The owner or the client | The owner signs with the saved image from Settings > Signature |
| Date of signing | The Ledger, at signing | One per party |
| Choice | You, at send | Options, single or multiple, a free-text box per option, an Other box |

A choice field with "Use the services list" is the Work Order scope picker. Settings > Contract templates > Services holds the services and their scope items. On the new contract screen you tick services, then items under each, type Other and a note per service, and a fee per service. The PDF prints only what you ticked, as a list. `{{scope:fees}}` prints one fee line per ticked service.

Versions: while no sent contract uses a template, a save changes it in place. Once a sent contract uses it, a save makes the next version. The sent contract keeps its own version. Old versions are never deleted.

A sent contract stores a copy of every value, including the service names and items. A later change to the client, the business, the template or the services list never changes it.

Every business starts with a short neutral sample agreement and work order. Replace their text with your own terms. The Ledger ships no legal terms.

## Send

1. Open the client, Contracts, New contract or work order.
2. Pick the template and the language. Check the fields. The preview is the same HTML the PDF uses, with the fields in blue boxes.
3. Add the signer at the client: name, email, optional phone. Pick how long the link lasts: 7, 14 or 30 days.
4. Optional, owner only: Sign as you when sending. The saved signature goes into your signature field.
5. Send for signing. The Ledger renders the PDF, adds the fields, stores it once at `business/<id>/contracts/<sha256>.pdf`, and emails the link when email is set up. Without email, copy the link or share it on WhatsApp.

Remind sends the same link again. Every reminder is logged. Void stops an unsigned contract and keeps it on record.

## The PDF fields

Every filled value and every signature sits in a named PDF form field, so other PDF readers show them as fields. Field names are the template keys. A ticked scope item is a field named `<key>_<service>_<item>`.

How the positions are found: the renderer wraps each field in a link to `https://field.ledger.invalid/<name>`. Chrome writes each link into the PDF with its exact page and rectangle. The Ledger reads those rectangles, removes the links, and puts a form field in each one. No second measuring pass, and page breaks are handled by the real layout.

The text on the page comes from the HTML render, which lays out Hebrew right to left. The form field holds the same value as text and draws nothing over it. pdf-lib never draws Hebrew.

In the sent PDF, the values you filled are locked. In the signed PDF, every field is locked.

## The signing page

The client opens the link on a phone or a computer. No account, no app. English or Hebrew, with a switch on the page.

- The page shows the PDF and a download.
- The client types the details the template asks for.
- With email set up, the client asks for a 6-digit code by email. It works for 10 minutes and allows 5 tries. After that, a new code. Without email, there is no code, and the evidence page says "Identity confirmed by link only".
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
