# Currency and exchange rates


## Principle

Shekels appear only when money arrives. Quotes, payment requests and proformas live in the client's currency. Open balances stay in that currency. The ILS figure is fixed once, on the receipt or tax invoice, so an open balance never drifts with the exchange rate.

## Rate source and date

- Source: Bank of Israel representative rate (שער יציג).
- Date: the payment date.
- Fallback: when no rate exists for the payment date (weekend, holiday, before publication), the last rate published before the payment date. This covers "the day before".
- The rate and the rate date print on every receipt and tax invoice.
- The rate freezes on finalize and never changes afterwards.

## Per-document behavior

| Document | Foreign currency | ILS shown | Rate |
|---|---|---|---|
| Quote | yes | off by default | none |
| Payment request, proforma, חשבון עסקה | yes | off by default. Toggle "Show ILS" | when shown: indicative BOI rate of the issue date, or a rate you type |
| Receipt, חשבונית מס/קבלה | yes | always | payment-date rule above, or the carried rate |
| חשבונית מס (305) | yes | always | invoice-date rule, or the carried rate |
| Credit documents | original currency | always | rate of the credited document |

## Rate options on a payment request or proforma

1. Default: foreign currency only, no ILS line.
2. "Show ILS": adds an ILS line at the BOI rate of the issue date, labeled indicative.
3. "Override rate": you type the rate. Label reads "Agreed rate".
4. "Carry rate to receipt": the receipt uses the rate from the payment request instead of the payment-date rate. The receipt shows the rate source ("Rate carried from PR-0088").

Allowed. The ILS figure on the receipt is the amount paid in shekels. For a payment made in foreign currency, ILS = foreign amount × carried rate.

## Balances

- Client balance is kept per currency. A client with USD and EUR requests shows two balances.
- A receipt closes the foreign amount. The ILS amount on the receipt becomes income.
- Partial payment: the foreign balance drops by the amount received. No ILS figure on the open remainder.
- No revaluation of open items. No unrealized FX gains or losses in the ledger.

## Client copy language

- Filed record: bilingual Hebrew and English, both currencies. This is the legal copy.
- Client copy: English only, both currencies, same number, same data, same allocation number.
- Both PDFs render from the same frozen record. Both hashes go to the audit chain.
- Per-client default: English copy or bilingual copy. Override per send.
