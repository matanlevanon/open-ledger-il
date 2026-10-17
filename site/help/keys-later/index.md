# הוספה או החלפה של מפתח אחרי ההתקנה

הוספת מפתח Gemini, Anthropic, Resend, Slack או גוגל דרייב ללדג'ר דרך לוח הבקרה של Cloudflare, בלי להריץ שוב את ההתקנה.

עודכן 2026-10-17

הלדג'ר קורא את המפתחות שלו מה-Worker שלו ב-Cloudflare. Worker הוא התוכנה שמריצה את הלדג'ר. שם מוסיפים או מחליפים מפתח.

## איפה

1. נכנסים ל-dash.cloudflare.com.
2. פותחים **Workers & Pages** ולוחצים **mtn-open-ledger**.
3. פותחים **Settings** ואז **Variables and Secrets**.
4. לוחצים **+ Add**. בוחרים **Secret** למפתחות ו-**Text** להגדרות רגילות. מקלידים את השם ומדביקים את הערך.
5. לוחצים **Deploy**. הלדג'ר משתמש בערך החדש תוך דקה.

השמות מדויקים, באותיות גדולות.

## אילו שמות

- **קריאת קבלות עם Gemini:** Secret בשם `GEMINI_API_KEY` עם המפתח, ו-Text בשם `AI_PROVIDER` עם הערך `gemini`.
- **קריאת קבלות עם Anthropic:** Secret בשם `ANTHROPIC_API_KEY` עם המפתח, ו-Text בשם `AI_PROVIDER` עם הערך `anthropic`.
- **שליחת מיילים:** Secret בשם `MAIL_API_KEY` עם מפתח Resend, ו-Text בשם `MAIL_FROM` עם השולח, למשל `Acme Ltd <billing@acme.co.il>`.
- **התראות Slack:** Secret בשם `SLACK_WEBHOOK_URL`.
- **הוצאות מגוגל דרייב:** Secret בשם `GOOGLE_SERVICE_ACCOUNT_JSON` עם כל התוכן של קובץ ה-JSON, מה-`{` הראשון עד ה-`}` האחרון.
- **טוקן MCP:** Secret בשם `MCP_TOKEN`, ראו [חיבור Claude](https://open-ledger.dev/help/connect-claude/).

## כללים

- לא מדביקים מפתח במייל, בצ'אט או במסמך. רק ב-Cloudflare או בתוכנת ההתקנה.
- אם מפתח דלף, יוצרים חדש אצל הספק, מוחקים שם את הישן, ומחליפים כאן.

עדיין תקועים? [כתבו לנו מעמוד המחירים.](https://open-ledger.dev/pricing/#setup)

## עוד עזרה

- [לפני ההתקנה: מה צריך להכין](https://open-ledger.dev/help/before-you-start/)
- [התקנת Open Ledger IL צעד אחר צעד](https://open-ledger.dev/help/install/)
- [יצירת ה-API token ב-Cloudflare](https://open-ledger.dev/help/cloudflare-token/)
- [כניסה ראשונה והגדרות](https://open-ledger.dev/help/first-sign-in/)
- [גישה לרואה חשבון או לעוזר](https://open-ledger.dev/help/users/)
- [חיבור לרשות המסים למספרי הקצאה](https://open-ledger.dev/help/tax-authority/)
- [מהצעת מחיר לקבלה: המסמכים הראשונים](https://open-ledger.dev/help/first-invoice/)
- [חתימה דיגיטלית: מה רשות המסים דורשת ואיך הלדג'ר עומד בכל כלל](https://open-ledger.dev/help/digital-signature/)
- [גבייה עם גרואו, קארדקום או סולק אחר](https://open-ledger.dev/help/payment-providers/)
- [הכנסת הוצאות ללדג'ר](https://open-ledger.dev/help/expenses/)
- [שליחת מסמכים במייל, בלי ספאם](https://open-ledger.dev/help/email/)
- [חיבור Claude או אפליקציית AI אחרת (MCP)](https://open-ledger.dev/help/connect-claude/)
- [עדכונים וגיבויים](https://open-ledger.dev/help/updates-backups/)
- [בעיות נפוצות ואיך פותרים אותן](https://open-ledger.dev/help/troubleshooting/)

Source: https://open-ledger.dev/help/keys-later/
