---
title: Take payments with Grow, Cardcom or another provider
description: Use a card payment provider for collecting money and the Ledger for the receipts, by hand or automatically, without two documents for one payment.
updated: 2026-10-17
published: true
order: 8
---

The Ledger issues the documents. A payment provider such as Grow, Cardcom, PayPlus or Bit collects the money. The two work side by side.

## First: turn off the provider's documents

Most providers issue their own receipt or invoice for every payment. Turn that off in the provider's settings, or ask their support to. Otherwise every payment gets two documents with two different numbers, and your books stop matching the bank.

## Way 1: by hand

1. In the Ledger, add the provider's payment link as a payment method: **Settings > Payment methods**, type **Card** or **Other**, paste the link.
2. Send the client a payment request with that method ticked.
3. When the provider tells you the money arrived, open the payment request and click **Record payment**. Pick **Card**, and paste the provider's transaction number as the reference.
4. The Ledger issues the receipt. Send it to the client.

Two minutes per payment. Fits a business with a few payments a week.

## Way 2: automatic, for technical users

The Ledger has an MCP endpoint, a door for other software, at its address followed by `/mcp`. It takes JSON-RPC calls (`tools/call`) with the header `Authorization: Bearer` and your MCP token. The tools include `list_clients`, `create_draft`, `finalize_document` and `record_payment`.

An automation tool such as Make, Zapier or n8n connects the provider to it:

1. In the provider, turn on the webhook for successful payments and point it at a new scenario.
2. In the scenario, find the client with `list_clients`, using the payer's name or email.
3. Record the payment against the open payment request with `record_payment` and `confirm: true`. The scenario needs the payment request's document id. Keep a small table of payment link to document id, filled when you send each request.
4. The Ledger issues the receipt.

This takes an afternoon to set up and test. Start with one small payment. For the MCP token, see [Connect Claude or another app](/help/connect-claude/).
