# Israel Invoices (חשבוניות ישראל): allocation-number integration

Sources: the ITA specs in `../הנחיות ליצרני תוכנה לתפעול מודל חשבוניות ישראל/`, the ITA Open API deck, the software-house connection procedure, the ITA FAQ (updated 27.05.2026) and the service page for manual requests (updated 01.06.2026). Research date: 24 Sep 2026.

## 1. When a business needs an allocation number

All four conditions together (spec v2, section 1.2, and the current regulation):

1. Document is a tax invoice type: 305 חשבונית מס, 320 חשבונית מס/קבלה, 310 ריכוז, 345 סוכן, or 332 חשבון עסקה/פרופורמה in the advance-approval case.
2. Amount before VAT above the threshold. ₪10,000 from 1.1.2026. ₪5,000 from 1.6.2026 (the current figure). No 2027 change announced as of today.
3. VAT amount above zero.
4. Client is an Israeli עוסק מורשה, or the client asks for a number.

The threshold is per invoice, not per month. A ₪25,000 monthly retainer billed on one invoice needs a number every month. Five ₪5,001 invoices each need their own number.

Outside the rule:
- Foreign clients billed at 0% VAT under section 30(a)(5). No VAT amount and no Israeli VAT number.
- 300 חשבון עסקה (unless used as 332 advance approval), 330 חשבונית זיכוי.
- Everything issued while עוסק פטור.

Voluntary requests are allowed for any amount. For a client who does not deduct input VAT, send customer_vat_number 999999998 (FAQ 55).

## 2. Onboarding path for you as a self-developer

The developer portal admits software houses only. An individual registers as one with a ת"ז. Self-use software needs no תעודת רישום תוכנה.

1. Register to the ITA personal area with your ID number. https://secapp.taxes.gov.il/logon/LogonPoint/tmindex.html . You receive a 6-character user code.
2. Skip the separate permission step. Procedure §1: when the software-house owner and the portal user are the same person, no separate permission is needed.
3. Sign every page of two documents:
   - כתב התחייבות לשימוש בשירותי API: https://www.gov.il/BlobFolder/service/connect-to-shaam/he/Service_Pages_shaam_Written-commitment-to-use-API-services.pdf
   - נספח אבטחת מידע: https://www.gov.il/BlobFolder/service/connect-to-shaam/he/Service_Pages_shaam_appen-info-security-for-software-house.pdf
4. Submit the software-house digital form with both scans: https://secapp.taxes.gov.il/mm-rishum-tochna/confirm-api/init-id-av . An approval email names you as the portal admin.
5. Developer portal: https://openapi-portal.taxes.gov.il/sandbox/support
   - Create an organization.
   - My Org Apps, Create new app. Redirect URI: `https://ledger.example.com/api/ita/callback` (the Worker serves every API route under `/api`).
   - Save client ID and client secret. The secret is not recoverable.
   - Subscribe the app to the Invoices product. No token works before the subscription.
6. Sandbox: open right away. Test VAT numbers look like 777777715.
7. Production: a separate PROD app, released only after ITA customer-service confirmation. No published timeline.

Contacts: registration lakohot-bt@taxes.gov.il. Technical APIsupport@taxes.gov.il, 02-5688444, Sunday to Thursday 8:00 to 17:00.

Start in October 2026. Production approval has no published lead time and you need numbers from the day you switch to עוסק מורשה.

## 3. OAuth2 flow the Worker implements

Grant: Authorization Code. Every Invoices endpoint is "OAuth2: User Restricted". No client-credentials flow exists.

| Step | Value |
|---|---|
| Authorize (browser) | `https://openapi.taxes.gov.il/shaam/tsandbox/longtimetoken/oauth2/authorize?response_type=code&client_id=...&scope=scope&redirect_uri=...` |
| Token | `POST .../shaam/{tsandbox or production}/longtimetoken/oauth2/token` |
| Token auth | `Authorization: Basic base64(client_id:client_secret)`, form-encoded body |
| Token body | `grant_type=authorization_code&code=...&redirect_uri=...&scope=scope` |
| Scope | the literal string `scope` |
| Access token TTL | `expires_in: 601` seconds |
| Refresh token TTL | `refresh_token_expires_in: 7776000` seconds (90 days) |
| Refresh | same token URL, `grant_type=refresh_token`, rotating: store the new refresh token after every use |
| Re-login | ITA identification (user code plus one-time code) about every 3 months |
| API call | `Authorization: Bearer <access_token>`, JSON body, all v2 field names lowercase |

Unverified: the production authorize host (assume `ita-api.taxes.gov.il/shaam/production/longtimetoken/oauth2/authorize`) and whether calls need an `X-IBM-Client-Id` header. Confirm both in the portal swagger.

Implementation rules:
- Store client secret as a Worker secret. Store refresh token encrypted in D1, key in a Worker secret.
- On 401: refresh once, retry once, then flag "Reconnect to ITA".
- Slack reminder at day 75 after the last interactive login. Dashboard banner at day 80.
- Your ת"ז goes in `user_id`. Keep the value in a Worker secret, never in the repo.

## 4. Endpoints

| Purpose | Path (append to `https://ita-api.taxes.gov.il/shaam/{tsandbox or production}/`) |
|---|---|
| Request one number | `Invoices/v2/Approval` |
| Request many | `Multi-invoices/v2/MultiApproval` |
| Decision on a refused invoice | `InvoiceDecisionApi/v1/Cancel`, `/Continue`, `/FurtherObjection` (spec v2.0 §4.2 name. Confirm in the portal swagger) |
| Check a supplier invoice by number (you as buyer) | `invoice-information/v2/details` |
| Find the number from supplier invoice details | `invoice-information/v2/confirmationNumber` |

## 5. Approval request fields (table 2.1)

Required (ח) or conditional (חמ) for this app:

| Field | Value this app sends |
|---|---|
| `invoice_id` | internal unique id (A50), never reused |
| `invoice_type` | 305, 320 or 332 |
| `vat_number` | your עוסק מורשה number |
| `user_id` | your ת"ז |
| `invoice_reference_number` | printed document number (A20), mandatory in v2 |
| `customer_vat_number` | client VAT number, or 999999998 |
| `customer_name` | client name |
| `invoice_date` | printed date, YYYY-MM-DD |
| `invoice_issuance_date` | system timestamp date, not editable |
| `accounting_software_number` | no certificate: your own ID or VAT number (v2 text). v1 used 99999999 |
| `amount_before_discount`, `discount`, `payment_amount`, `vat_amount`, `payment_amount_including_vat` | from the document, N12.2 |
| `action` | 3 for reverse charge, 4 for a tax invoice born from a 332 |
| `items[]` | optional lines: index, description, quantity, price_per_unit, total_amount, vat_rate, vat_amount, category 2 (service) |

Date window: up to 1 year back (error 434) and up to 30 days ahead (error 435).

## 6. Response handling

| Result | Meaning | App action |
|---|---|---|
| 200, `approved: true` | number granted | store full `confirmation_number`, print the rightmost 9 digits under "מספר הקצאה:", add to PCN874 |
| 200, code 460 | data fine, invoice refused | show the four choices below |
| 200, code 461 | refused earlier, no decision sent | show the four choices |
| 200, code 462 | refused earlier, decision sent | no action |
| 400, 431 | wrong VAT number | fix client record, resend |
| 400, 434 or 435 | date outside window | fix date |
| 400, 446 | user_id or user_name missing | config error |
| 401 | token | refresh and retry |
| 5xx or timeout | ITA down | queue, retry, then manual web app |

The four choices after a refusal (section 2.2.2):
1. Cancel the invoice. Standard cancellation, then `InvoiceDecisionApi/v1/Cancel`.
2. Continue without a number. The document prints "אין לנכות מס תשומות בגין חשבונית זו" in bold. Then `/Continue`.
3. Reverse charge, with client agreement. New Approval call with the same details, VAT 0 and `action=3`. Cancel the original. The new invoice prints "בגין חשבונית זו לקוח חייב לדווח חשבונית עצמית".
4. Request a hearing. `/FurtherObjection` and a link to the ITA portal. After a win, request again with the same `invoice_id`.

## 7. Where the call sits in the issue flow

1. Draft passes validation.
2. Transaction: assign the document number, write the final row with status `awaiting_allocation`.
3. Call Approval with the document number as `invoice_reference_number`.
4. Success: write `confirmation_number`, status `final`, render and sign the PDF, send.
5. Refusal: status `allocation_refused`, open the four-choice screen. The number stays used. No gap in the series.
6. Outage: status `allocation_pending`, retry every 15 minutes for 24 hours, Slack alert, manual web app as fallback.

The PDF never goes out before step 4 or a recorded decision.

## 8. Manual fallback

Service page: https://www.gov.il/he/service/request-assignment-number-for-tax-invoice
Online app: https://secapp.taxes.gov.il/em-hkz-hsb-intr

- Open to עוסקים מורשים using an invoice book or software not connected to the service.
- Enter client VAT number, invoice number, amount before VAT, VAT amount.
- One invoice at a time. A number from the web app cannot be cancelled (FAQ 9).
- Open Ledger IL keeps a "Enter allocation number" field for this path, with a note of the source.

## 9. Buyer side (your expenses)

After the switch you deduct input VAT. A supplier tax invoice above the threshold without a valid allocation number gives no deduction. The expense module calls `invoice-information/v2/confirmationNumber` or `/details` for each supplier invoice above ₪5,000 and flags any without a match.

## 10. PCN874

If you file the detailed VAT report, each tax-invoice row carries the short allocation number (9 rightmost digits) in the new N(9) field. Whether you file PCN874 depends on your reporting status. Ask your accountant.
