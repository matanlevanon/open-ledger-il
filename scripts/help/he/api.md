---
title: API לאפליקציות אחרות
description: מחברים את Financy, Make, Zapier, n8n או את התוכנה של רואה החשבון ללדג'ר עם מפתח API, ומה ה-API יכול ולא יכול לעשות.
updated: 2026-10-20
published: true
nav: API לאפליקציות אחרות
order: 13
---

ה-API נותן לאפליקציה אחרת לקרוא את הלדג'ר: Financy שמשווה חיובים בבנק, Make, Zapier או n8n שמעבירים נתונים בין אפליקציות, או התוכנה של רואה החשבון. כל אפליקציה מקבלת מפתח משלה, ואפשר לנתק כל אחת מהן בכל רגע.

ל-Claude ולאפליקציות AI אחרות משתמשים ב-[MCP](/help/connect-claude/).

## יצירת מפתח

1. פותחים **הגדרות > MCP ו-API**. רק בעלים רואים את הלשונית הזו.
2. תחת **API לאפליקציות אחרות** לוחצים **יצירת מפתח**.
3. נותנים לו שם לפי האפליקציה, למשל "Financy".
4. בוחרים **קריאה** או **קריאה וכתיבה**. לרוב האפליקציות מספיקה קריאה.
5. לוחצים **יצירת מפתח**. המפתח מוצג פעם אחת. מעתיקים אותו ולוחצים **העתקתי**.

המפתח אבד? מבטלים אותו ויוצרים חדש.

## מה נותנים לאפליקציה

שלושה ערכים, כולם באותו עמוד:

- **כתובת ה-API**: `https://<your-ledger>/v1`, כשבמקום your-ledger באה הכתובת של הלדג'ר שלכם
- **מזהה העסק**: המספר שלידה. גם מספר העוסק של העסק עובד.
- **המפתח**: מתחיל ב-`ol_live_`

## מפתח קריאה ומפתח כתיבה

- מפתח **קריאה** קורא את פרטי העסק, לקוחות, מסמכים, קובצי PDF, תשלומים, הוצאות וספקים.
- מפתח **כתיבה** יכול גם ליצור לקוחות וטיוטות מסמכים: הצעות מחיר, דרישות תשלום, חשבונות עסקה וקבלות.
- אף מפתח לא יכול להפיק, לשלוח, לזכות, לבטל או למחוק מסמך. טיוטה מה-API מחכה בלדג'ר עד שאתם בודקים ומפיקים אותה בעצמכם.

## ביטול מפתח

**הגדרות > MCP ו-API**, בשורה של המפתח, **ביטול מפתח**, ומאשרים. האפליקציה שהשתמשה בו מפסיקה לעבוד מיד. המתג של ה-MCP באותו עמוד מכבה רק את ה-MCP, לא את ה-API.

## למפתחים

### אימות

כל קריאה נושאת שתי כותרות:

```
Authorization: Bearer ol_live_...
X-Business-Id: 1
```

מפתח חסר, לא מוכר או מבוטל מקבל 401. מפתח של עסק אחר מקבל 403.

### דפדוף וסנכרון

רשימות עונות `{ "data": [...], "nextCursor": "..." }`. מעבירים `cursor=<nextCursor>` לעמוד הבא, עד ש-`nextCursor` הוא `null`. `limit` בין 1 ל-200, ברירת המחדל 50. מוסיפים `updatedSince=2026-10-01T00:00:00Z` כדי לקבל רק מה שהשתנה מאז הסנכרון האחרון.

### כסף ותאריכים

סכומים ביחידות קטנות עם שדה `currency`: `11800` עם `ILS` הם ₪118.00. תאריכים `YYYY-MM-DD`. זמנים ב-ISO, ב-UTC. מזהים הם מספרים.

### שגיאות

כל שגיאה היא `{ "error": { "code": "...", "message": "..." } }` עם 400, 401, 403, 404, 409, 422 או 429. מפתח קריאה בקריאת כתיבה מקבל 403 `scope_required`.

### מגבלת קצב

120 בקשות לדקה לכל מפתח. מעבר לזה, 429 עם כותרת `Retry-After` בשניות.

### Idempotency

שולחים `Idempotency-Key: <unique-string>` עם מחרוזת ייחודית ב-POST. אותו מפתח ואותו גוף בתוך 24 שעות מחזירים את התשובה הראשונה ולעולם לא יוצרים טיוטה שנייה. אותו מפתח עם גוף אחר מקבל 409.

### נקודות קצה

מחליפים את המפתח ואת הכתובת בשלכם.

| קריאה | מה היא מחזירה |
|---|---|
| `GET /v1/business` | שם, מספר עוסק, מצב משפטי, מטבע, כתובת |
| `GET /v1/clients` | לקוחות עם היתרה הפתוחה. סינון `q`, `active` |
| `GET /v1/clients/{id}` | לקוח אחד |
| `GET /v1/documents` | מסמכים עם סכומים. סינון `type`, `status`, `from`, `to`, `clientId` |
| `GET /v1/documents/{id}` | מסמך אחד עם שורות ותשלומים |
| `GET /v1/documents/{id}/pdf` | עותק הלקוח ב-PDF, למסמך סופי בלבד |
| `GET /v1/payments` | תשלומים שנרשמו. סינון `from`, `to` |
| `GET /v1/expenses` | הוצאות. סינון `from`, `to`, `status` |
| `GET /v1/suppliers` | ספקים |
| `POST /v1/clients` | יוצר לקוח (מפתח כתיבה) |
| `POST /v1/documents` | יוצר טיוטה (מפתח כתיבה) |

```
curl https://ledger.example.com/v1/business -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1"
curl "https://ledger.example.com/v1/clients?q=acme" -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1"
curl https://ledger.example.com/v1/clients/12 -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1"
curl "https://ledger.example.com/v1/documents?type=305,320&from=2026-10-01" -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1"
curl https://ledger.example.com/v1/documents/40 -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1"
curl https://ledger.example.com/v1/documents/40/pdf -o document.pdf -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1"
curl "https://ledger.example.com/v1/payments?from=2026-10-01" -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1"
curl "https://ledger.example.com/v1/expenses?status=new" -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1"
curl https://ledger.example.com/v1/suppliers -H "Authorization: Bearer ol_live_YOUR_KEY" -H "X-Business-Id: 1"
curl https://ledger.example.com/v1/clients -X POST -H "Authorization: Bearer ol_live_YOUR_WRITE_KEY" -H "X-Business-Id: 1" -H "Content-Type: application/json" -d "{\"nameEn\":\"Acme Ltd\",\"email\":\"billing@acme.example\"}"
curl https://ledger.example.com/v1/documents -X POST -H "Authorization: Bearer ol_live_YOUR_WRITE_KEY" -H "X-Business-Id: 1" -H "Idempotency-Key: oct-retainer-12" -H "Content-Type: application/json" -d "{\"type\":\"PR\",\"clientId\":12,\"lines\":[{\"description\":\"Retainer, October\",\"unitPriceMinor\":500000}]}"
```

ב-Windows, ב-PowerShell:

```
Invoke-RestMethod https://ledger.example.com/v1/business -Headers @{ Authorization = "Bearer ol_live_YOUR_KEY"; "X-Business-Id" = "1" }
```

התשובה של טיוטה כוללת `editUrl`, העמוד בלדג'ר שבו בודקים ומפיקים אותה.

### התיאור המלא

הלדג'ר שלכם מפרסם אותו, עם כל שדה ודוגמה, בכתובת `https://<your-ledger>/v1/openapi.json`. לא צריך מפתח. מייבאים אותו ל-Postman, ל-Make או לכל כלי OpenAPI.
