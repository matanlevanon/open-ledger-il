# Digital signatures: what the Tax Authority requires and how the Ledger meets each rule

The rules for emailing receipts and invoices under instruction 18ב, the Ledger feature behind each rule, and the one step left to you.

Updated 2026-10-17

An emailed receipt or invoice is a computerized document (מסמך ממוחשב) in the eyes of the Tax Authority. Instruction 18ב of the Income Tax bookkeeping instructions (הוראות מס הכנסה (ניהול פנקסי חשבונות), תשל"ג-1973) sets the rules for sending one. This page lists each rule, the Ledger feature behind each one, and the one step only you take.

This page explains the rules. For your own case, ask your accountant.

## Which documents

Instruction 18ב covers receipts, invoices, credit notes and tax invoices. Each one goes out only after the Ledger records the document in your books. In the Ledger, a draft never leaves the system: only a finalized document is signed and sent.

## Each rule and what the Ledger does

| Rule | Source | What the Ledger does |
| --- | --- | --- |
| The document comes straight from the permanent records, with no retyping | 18ב(א) | The PDF is rendered from the finalized document. Only the signature and the words מסמך ממוחשב are added. A final document never changes |
| The words מסמך ממוחשב appear on the document | 18ב(א) | Every PDF prints מסמך ממוחשב |
| The issuer signs with a secured or a certified electronic signature | Instruction 1, definition of מסמך ממוחשב | Every finalized PDF carries a PAdES digital signature made with your business's own key |
| A notice to your assessing officer (פקיד השומה) by registered mail, before the first document | 18ב(ב) | Your step. See below |
| The client agrees, in writing or electronically, before the first document. You keep the agreement and any withdrawal as part of your books | 18ב(ג) | Consent per client, by email link or recorded by hand, with date and source. Sending is blocked without consent. The full history stays on the client |
| With a secured signature, payment only by card, crossed cheque marked "not negotiable", or direct bank transfer from the client's account | 18ב(ד) | Receipts refuse cash and uncrossed cheques while the secured signature is on |
| Signed documents stay on computer storage as part of the books, for 7 years from the end of the tax year or 6 years from the return, the later | 25(ג), 25(ג2) | PDFs are stored write-once. A quarterly backup goes to a second place |
| A readable copy, marked as a copy, on demand | 18(ב)(2) | The first PDF reads מקור. Every later print reads העתק נאמן למקור |

## Secured or certified signature

The Electronic Signature Law, התשס"א-2001, defines three levels:

- **Electronic signature:** any electronic mark, for example a scanned signature image. Not enough for 18ב.
- **Secured signature (חתימה אלקטרונית מאובטחת):** under the signer's sole control, identifies the signer, and exposes any change to the document after signing.
- **Certified signature (חתימה אלקטרונית מאושרת):** a secured signature plus a certificate from a licensed certifying authority, today Comsign or Personal ID.

Instruction 18ב accepts either a secured or a certified signature. The Ledger uses a secured signature:

- The installer creates a 3,072-bit signing key and a certificate in your business name, on your own computer, valid for 10 years. The key is stored only in your Cloudflare Worker's secrets. MTN holds no copy.
- Each PDF gets a certifying PAdES signature. No change of any kind is allowed after signing, so a PDF reader shows any later edit as a broken signature.
- The signature image you upload under **Settings > Signature** is a picture on the page. The digital signature is separate, and the law counts the digital signature.

The trade-off: a secured signature brings the payment rule of 18ב(ד). A certified signature has no such limit, but needs a paid certificate from a certifying authority. The Ledger signs with a secured signature only.

The law also puts a duty on you as the key holder. Guard the key: protect your Cloudflare account with two-factor sign-in, and give no one else access to the Worker's secrets. If you think someone got hold of the key, tell the clients who rely on your documents, and replace the key and certificate.

## What your client sees

In Adobe Acrobat Reader, the signature panel shows the document is signed and unchanged since signing. The certificate comes from you, not from a certifying authority, so Acrobat marks the signer's identity as unknown. This is normal for a secured signature. The check for changes still works.

A browser's built-in PDF viewer shows no signature panel. The signature is still in the file.

## Your one step: the notice to the assessing officer

Before you email your first document, send your assessing officer a letter by registered mail saying you will send computerized documents. The Ledger has no way to send this letter for you and does not track the step. Keep the post office receipt with your records. Your accountant has probably filed one before, so ask first.

A sample text, in Hebrew:

**הנדון: הודעה על משלוח מסמכים ממוחשבים**

בהתאם לסעיף 18ב(ב) להוראות מס הכנסה (ניהול פנקסי חשבונות), התשל"ג-1973, הריני להודיעכם כי החל מיום ____ אשלח ללקוחותיי קבלות וחשבוניות כמסמכים ממוחשבים, חתומים בחתימה אלקטרונית מאובטחת.

שם העסק, מספר עוסק או ת"ז, כתובת, חתימה ותאריך

## Get a client's consent

1. Open a finalized document and click **Send by email**. For a client with no consent yet, the Ledger shows "has not consented to digital documents yet" and two buttons.
2. **Send consent request** emails the client a link. Once the client accepts, send the document again.
3. **Record consent manually** is for a client who agreed another way, for example in a signed contract. Pick the source and the date.

The client's page shows the consent status, date and method. To record a withdrawal, open the client, click **Edit**, and untick **Consented to digital documents**.

## Signature mode None

**Settings > Signature** has two modes. **Secured signature** is the default. With **None**, PDFs carry no digital signature and do not meet 18ב, so the Ledger refuses to send them by email or WhatsApp. You still view and download them. Use None only if you print your documents and sign them by hand.

## Cash payments

With the secured signature on, the Ledger refuses cash on a receipt, per 18ב(ד). If you take cash, ask your accountant how to record the payment.

## Allocation numbers are a separate rule

A tax invoice above the threshold also needs an allocation number from the Tax Authority. This is the Israel Invoices rule, not 18ב. See [Connect to the Tax Authority](https://open-ledger.dev/en/help/tax-authority/).

Still stuck? [Write to us from the pricing page.](https://open-ledger.dev/en/pricing/#setup)

## More help

- [Before you install: what you need](https://open-ledger.dev/en/help/before-you-start/)
- [Install Open Ledger IL step by step](https://open-ledger.dev/en/help/install/)
- [Create the Cloudflare API token](https://open-ledger.dev/en/help/cloudflare-token/)
- [First sign-in and setup](https://open-ledger.dev/en/help/first-sign-in/)
- [Give your accountant or assistant access](https://open-ledger.dev/en/help/users/)
- [Connect to the Tax Authority for allocation numbers](https://open-ledger.dev/en/help/tax-authority/)
- [From quote to receipt: your first documents](https://open-ledger.dev/en/help/first-invoice/)
- [Take payments with Grow, Cardcom or another provider](https://open-ledger.dev/en/help/payment-providers/)
- [Get your expenses into the Ledger](https://open-ledger.dev/en/help/expenses/)
- [Send documents by email, and keep them out of spam](https://open-ledger.dev/en/help/email/)
- [Connect Claude or another AI app (MCP)](https://open-ledger.dev/en/help/connect-claude/)
- [Add or change a key after the install](https://open-ledger.dev/en/help/keys-later/)
- [Updates and backups](https://open-ledger.dev/en/help/updates-backups/)
- [Common problems and how to fix them](https://open-ledger.dev/en/help/troubleshooting/)

Source: https://open-ledger.dev/en/help/digital-signature/
