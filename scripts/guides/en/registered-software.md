---
title: "Software registered with the Tax Authority: what it means and how to check"
description: Who must register accounting software with the Israel Tax Authority, what registration says and does not say, and how to check a registration.
published: true
updated: 2026-10-14
sources:
  - https://www.gov.il/he/service/registration-software-designed-managing-computerized-accounting-system
  - https://www.gov.il/he/service/itc-software-registry-for-computerized-accounting-systems
  - {{repo}}/blob/main/docs/legal-requirements.md
  - {{repo}}/blob/main/docs/israel-invoices-api.md
  - https://he.wikisource.org/wiki/%D7%94%D7%95%D7%A8%D7%90%D7%95%D7%AA_%D7%9E%D7%A1_%D7%94%D7%9B%D7%A0%D7%A1%D7%94_%28%D7%A0%D7%99%D7%94%D7%95%D7%9C_%D7%A4%D7%A0%D7%A7%D7%A1%D7%99_%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%95%D7%AA%29
faq:
  - q: I use software I wrote for my own business. Must I register it?
    a: No, as long as it runs for your business only. The duty covers software meant for sale, for rent or for others to use.
  - q: Is free software exempt?
    a: No. The duty includes software others use at no cost.
  - q: Does registration mean the software was tested and found correct?
    a: No. The certificate itself says registration does not confirm that the software works correctly or suits bookkeeping.
  - q: How do I check?
    a: Ask the producer for the certificate number and its validity, and check the Tax Authority registry of registered software.
---

A business that keeps its books on a computer follows the rules for a computerized accounting system, in the appendix to instruction 36 of the Income Tax (Bookkeeping) Instructions [3]. Part of those rules is about the software itself: whoever produces such software for others registers it with the Tax Authority [1].

This guide covers who must register, what registration says, and how to check that software is registered.

## Who must register software

The Tax Authority service page puts the duty on "יצרני תוכנות לניהול מערכת חשבונות ממוחשבת המיועדת למכירה, להשכרה או לשימושם של אחרים (כולל שימוש בחינם)": producers of software for a computerized accounting system meant for sale, for rent or for use by others, free use included [1].

Three things follow from that wording:

- **The duty is the producer's**, not the business that uses the software. The business picks registered software, and the producer registers it.
- **Price does not matter.** Software others use at no cost needs registration too.
- **Own use is exempt.** A business that writes software and runs it for itself only does not sell it, rent it or give it to others, so this duty does not apply [3]. The moment it runs the software for another business, for example its clients' books, it registers first [3].

## What registration says

The Tax Authority issues a registration certificate with a number, the software name, the version registered and a validity period [2]. The certificate also says what registration does not mean: "אין ברישום התוכנה כדי לאשר את נכונות ביצועיה והתאמתה לניהול פנקסי חשבונות", registration does not confirm that the software works correctly or suits bookkeeping [2].

So registration is a condition for offering software to others. It is not an approval that the software calculates correctly. The books remain the business's responsibility, and the accountant checks them.

## Versions

A certificate is issued for a specific version of the software [2]. Under appendix 5 to instruction 36 of the bookkeeping instructions, a program that was changed is not the same software, except for updates to amounts [5]. So each new version needs its own approval. The Tax Authority's online service has a request to add a new version to registered software [1]. The Tax Authority answers within 90 days, usually sooner when the file is complete [1].

## How to check that software is registered

1. **Ask the producer for the certificate number.** A producer of registered software knows it, and usually publishes it.
2. **Check the validity.** The certificate states the dates it is valid between [2].
3. **Check the Tax Authority registry.** The Tax Authority keeps a registry of software registered for computerized accounting systems [2]. In [the registry search](https://secapp.taxes.gov.il/mm-find-tochna/main/rashi) you search by software name, by the name of the software house, or by its entity number. It does not search by certificate number. You can show valid certificates only, and the "תוקף אישור" field shows when each one ends.
4. **Check the version.** If the version you use is newer than the one on the certificate, ask the producer whether it has been added.

## Software registration and the Tax Authority connection are two things

It is easy to mix up a software registration certificate with the connection to the Tax Authority API, through which you ask for allocation numbers. They are two separate processes [3]:

- **A registration certificate** depends on who uses the software. Software for your own use needs no certificate [3].
- **The API connection** is for asking for allocation numbers. Even a business that develops for itself registers as a software house, with an ID number, and opens an app on the Tax Authority developer portal [3].

## What else to check

Registration is a starting point. Also ask:

- Does the software produce a **unified file** (מבנה אחיד) when your accountant or the Tax Authority asks for one?
- Does it keep documents for **7 years** and back up **every quarter**, as the instructions require [3]?
- Is an issued document **locked against edits**, and is each series **gapless**?
- Can it ask for **allocation numbers** if you are an עוסק מורשה?

## How Open Ledger IL does it

Open Ledger IL (חשבונאות פתוחה) is registered with the Israel Tax Authority as software for a computerized accounting system, registration certificate 281801, valid to 31 Oct 2028 [2]. The certificate was issued for version 1.1.0, and new versions are added to it as they are filed. You can check it in the Tax Authority's registry of registered software [2].

The code is open, so you can check for yourself how the system locks, numbers and keeps documents.
