# Connect to the Tax Authority for allocation numbers

Allocation numbers with the installer or with your own setup: what each path takes, how to connect, and the 90-day reconnect.

Updated 2026-10-17

A tax invoice to an Israeli עוסק מורשה above the threshold needs an allocation number (מספר הקצאה) from the Tax Authority. With a connection, the Ledger asks for the number when you finalize the invoice and prints it on the document.

An עוסק פטור issues no tax invoices, so it needs no connection. Connect later, when you become עוסק מורשה.

## Two ways to connect

| | With the installer | Self setup from the source code |
| --- | --- | --- |
| Tax Authority API app | MTN's approved app. Nothing to apply for | Register in the developer portal, apply for your own app, wait for approval |
| Client id and secret | None. The installer sets the connection | You store them as Worker secrets |
| Calls from Israel | Always, through MTN's Israeli route | The Tax Authority turns away calls from outside Israel. You catch Cloudflare's Tel Aviv data center some of the time, or run your own relay on an Israeli server |
| Setup time | Part of the 3-minute install | Hours, plus the approval wait |
| Cost | Included in the installer price | Free, plus any server you run |

## With the installer

1. In the Ledger, open **ITA** in the sidebar.
2. Click **Connect to ITA**.
3. The Tax Authority's sign-in page opens. Sign in with the business's own Tax Authority user: the user code and the one-time code sent to your phone.
4. Approve the request. The consent screen names MTN's app. You come back to the Ledger, and the page shows **Connected**, with the days left.

## Self setup

1. Register in the Tax Authority developer portal and create an API app for Israel Invoices. Wait for production approval.
2. Put the app's client id and secret in the Worker's secrets, as the [setup guide](https://github.com/matanlevanon/open-ledger-il/blob/main/docs/deploy.md) lists.
3. Solve the Israel-only rule. On the ITA page, click **Check route**. "Direct (from TLV): reached the ITA" means the call got through this time. "From FRA: turned away, HTTP 403" means Cloudflare served you from Frankfurt. For calls that work every time, run the relay from `tools/ita-relay` on a server with an Israeli address, for example Oracle Cloud's free tier in Jerusalem.
4. Then **Connect to ITA** as above.

No app at all? The Ledger also runs in manual mode: each invoice that needs a number waits on the ITA page, you request the number in the Tax Authority web app, and type it back.

[Buy the installer](https://open-ledger.matanlevanon.com/help/install/) to skip steps 1 to 3.

## Every 90 days

The Tax Authority login lasts 90 days on both paths. The ITA page shows **Login ends in N days**. With Slack alerts on, the Ledger warns you on days 75, 85 and 89. When it ends, open **ITA** and click **Connect again**. An invoice still waiting for a number shows in the **Allocation queue** on the same page. After you reconnect, click **Retry now**.

## When a number is refused

The ITA page shows the reason. The choices are to cancel the invoice, continue without a number with a notice on the document, or switch to reverse charge with the client's agreement. Ask your accountant which fits.

Still stuck? [Write to us from the pricing page.](https://open-ledger.matanlevanon.com/pricing/#setup)

## More help

- [Before you install: what you need](https://open-ledger.matanlevanon.com/help/before-you-start/)
- [Install Open Ledger IL step by step](https://open-ledger.matanlevanon.com/help/install/)
- [Create the Cloudflare API token](https://open-ledger.matanlevanon.com/help/cloudflare-token/)
- [First sign-in and setup](https://open-ledger.matanlevanon.com/help/first-sign-in/)
- [Give your accountant or assistant access](https://open-ledger.matanlevanon.com/help/users/)
- [From quote to receipt: your first documents](https://open-ledger.matanlevanon.com/help/first-invoice/)
- [Take payments with Grow, Cardcom or another provider](https://open-ledger.matanlevanon.com/help/payment-providers/)
- [Get your expenses into the Ledger](https://open-ledger.matanlevanon.com/help/expenses/)
- [Send documents by email, and keep them out of spam](https://open-ledger.matanlevanon.com/help/email/)
- [Connect Claude or another AI app (MCP)](https://open-ledger.matanlevanon.com/help/connect-claude/)
- [Add or change a key after the install](https://open-ledger.matanlevanon.com/help/keys-later/)
- [Updates and backups](https://open-ledger.matanlevanon.com/help/updates-backups/)
- [Common problems and how to fix them](https://open-ledger.matanlevanon.com/help/troubleshooting/)

Source: https://open-ledger.matanlevanon.com/help/tax-authority/
