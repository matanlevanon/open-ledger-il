---
title: "The unified file (מבנה אחיד): what it is and when your accountant needs it"
description: What the Israel Tax Authority unified file is, what is inside it, and when your accountant or the Tax Authority asks your software for one.
published: false
updated: 2026-10-14
sources:
  - {{repo}}/blob/main/src/modules/exports/unified-file/build.ts
  - {{repo}}/blob/main/src/modules/exports/unified-file/records.ts
  - {{repo}}/blob/main/docs/legal-requirements.md
  - https://www.gov.il/he/service/registration-software-designed-managing-computerized-accounting-system
  - https://www.gov.il/BlobFolder/service/registration-software-designed-managing-computerized-accounting-system/he/Service_Pages_Income_tax_horaot-131.pdf
  - https://he.wikisource.org/wiki/%D7%94%D7%95%D7%A8%D7%90%D7%95%D7%AA_%D7%9E%D7%A1_%D7%94%D7%9B%D7%A0%D7%A1%D7%94_%28%D7%A0%D7%99%D7%94%D7%95%D7%9C_%D7%A4%D7%A0%D7%A7%D7%A1%D7%99_%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA%29
  - https://ey.co.il/-/%D7%94%D7%A0%D7%97%D7%99%D7%95%D7%AA-%D7%97%D7%93%D7%A9%D7%95%D7%AA-%D7%9C%D7%A9%D7%99%D7%93%D7%95%D7%A8-%D7%A7%D7%95%D7%91%D7%A5-%D7%91%D7%9E%D7%91%D7%A0%D7%94-%D7%90%D7%97%D7%99%D7%93-%D7%94%D7%97/
faq:
  - q: What is in the file?
    a: Two text files. INI.TXT with the business, the software and a summary of the records, and BKMVDATA.TXT with the documents, their lines and payments.
  - q: Do quotes and payment requests go in?
    a: No. They have no code in the specification's appendix, so they stay out.
  - q: Do I produce the file myself?
    a: Usually not. You produce it when someone asks for it, and sound software builds it from the data it already holds.
  - q: Does a cancelled document appear in the file?
    a: Yes. A cancelled document is included, marked as cancelled.
---

A unified file (מבנה אחיד) is an export of the data in accounting software, in one format the Israel Tax Authority set. Every program writes it the same way, so whoever receives it can read it without knowing which software you used. This guide describes version 1.31 of the Tax Authority's instructions [2].

## What is inside the file

The file is two text files, packed together [1]:

- **INI.TXT**: the business details, the software that produced the file, and a summary row for each record type in the file [1].
- **BKMVDATA.TXT**: the data itself, one record per line [1].

Each record has a code. These are the main ones [1]:

| Code | What it holds |
|---|---|
| A100 | Opening record |
| B110 | A bookkeeping account, for example a client account |
| C100 | Document header: type, number, date, client and amounts |
| D110 | Document lines |
| D120 | Payment details on receipts |
| Z900 | Closing record |

Software that is also a double-entry ledger or a stock system adds more records, such as journal entries (B100) and stock items (M100) [1].

The two files are packed together: BKMVDATA.TXT is compressed in an inner ZIP file, which sits with INI.TXT in one folder inside a single ZIP file [1]. That is the file you hand over.

Each field in a record has a fixed width, set by a table in the specification [2]. A text field is left aligned and padded with spaces. A number field is right aligned and padded with zeros [2].

## Which documents go in

The file covers a period. Every numbered document of a type that has a code in appendix 1 of the specification goes in, by document date [1]:

- Tax invoices, tax invoice/receipts, receipts and credit invoices go in.
- The code table in the file specification gives code 300 to "חשבונית/חשבונית עסקה" [5]. It does not say whether a pro forma that is only a demand for payment must go in. [TO CHECK] The requirements document in the repository [3] and the export code [1] still disagree on this.
- A cancelled document goes in too, marked in a dedicated field [1].
- Quotes and payment requests stay out, since they have no code in the appendix [1].

## When your accountant needs the file

Software that must be registered has to be able to produce these files, as the director instructs, under appendix 5 to instruction 36 of the bookkeeping instructions [6]. There is no fixed list of cases in the instructions. In practice, the Tax Authority asks for the unified file when it opens an audit of the books [7].

What can be said without an outside source: the file is meant to be read by someone who does not use your software. An accountant on other software can load your documents from it. An audit can check the series, the amounts and the cancelled documents from it.

## What to check when you produce a file

Sound software shows a summary before the download that you can compare with your books [1]:

1. **Counts per record type**: how many document headers, lines and payments.
2. **Totals per document type**: how many documents of each type, and their total in shekels [1].
3. **Warnings**: for example a tax invoice still waiting for an allocation number and so left out [1], or a software registration field still empty [1].

Compare the summary with the income report for the same period before you hand the file over.

## The link to software registration

INI.TXT has fields that describe the software that produced the file, among them its Tax Authority registration number [1]. Software not yet registered prints zeros there [1]. Producing the file is a condition of registration: the Tax Authority requires a module that produces unified files, a declaration that it exists, and a passing report from its file-review simulator [4].

## How Open Ledger IL does it

Open Ledger IL produces a unified file, version 1.31, for any period you pick, from Reports. Before the download it shows the summary per record type and a table per document type, with warnings about documents left out. Every field is checked against the record width in the specification, so a layout mistake cannot shift the columns. An accountant with access to the system can produce the file themselves.
