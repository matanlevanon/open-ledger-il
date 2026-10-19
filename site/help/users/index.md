# גישה לרואה חשבון או לעוזר

הוספת רואה חשבון, עוזר או מייל נוסף שלכם ללדג'ר, בלדג'ר וב-Cloudflare Access, והסרה שלהם.

עודכן 2026-10-17

לכל אדם יש תפקיד בכל עסק.

- **Owner (בעלים):** הכול, כולל הגדרות, משתמשים, מספור וחיבור לרשות המסים.
- **Assistant (עוזר):** לקוחות, הצעות מחיר, דרישות תשלום, קבלות, שליחה והוצאות. בלי הגדרות, משתמשים או רשות המסים.
- **Accountant (רואה חשבון):** רואה את מה שאתם מאשרים, עד תאריך סיום. כל פעולה נרשמת. רואה חשבון אף פעם לא מוציא או מבטל מסמך.

## הוספת אדם

שני מקומות, שניהם חובה.

### 1. בלדג'ר

1. בוחרים את העסק בבורר שלמעלה.
2. בתפריט הצד פותחים **Accountant > Users**.
3. לוחצים **Invite someone**.
4. מקלידים מייל ובוחרים תפקיד. לרואה חשבון צריך גם תאריך סיום ומתגים: מסמכי הכנסה, הוצאות, דוחות, החבילה החודשית, מבנה אחיד.
5. לוחצים **Send invite**.

למייל נוסף שלכם בוחרים **Owner**.

### 2. ב-Cloudflare Access

מיילים שהכנסתם בתוכנת ההתקנה כבר שם. לכל אחד חדש:

1. נכנסים ל-dash.cloudflare.com. בתפריט השמאלי, תחת **Protect & connect**, פותחים **Zero Trust**.
2. נכנסים ל-**Access controls > Applications** ומוצאים את **MTN Open Ledger** ברשימה.
3. בשורה שלו לוחצים על שם המדיניות בעמודה **Policies**. המדיניות נפתחת לעריכה.
4. תחת **Include > Emails** מוסיפים את המייל.
5. לוחצים **Save policy**.

עד שלב 5, Cloudflare עוצר את האדם בעמוד הכניסה שלו.

## הסרת אדם

1. בלדג'ר: **Accountant > Users**, לוחצים **Revoke** בשורה שלו.
2. ב-Cloudflare Access: פותחים את אותה מדיניות, מוחקים את המייל מ-**Include > Emails** ולוחצים **Save policy**.

עדיין תקועים? [כתבו לנו מעמוד המחירים.](https://open-ledger.dev/pricing/#setup)

## עוד עזרה

- [לפני ההתקנה: מה צריך להכין](https://open-ledger.dev/help/before-you-start/)
- [התקנת Open Ledger IL צעד אחר צעד](https://open-ledger.dev/help/install/)
- [יצירת ה-API token ב-Cloudflare](https://open-ledger.dev/help/cloudflare-token/)
- [כניסה ראשונה והגדרות](https://open-ledger.dev/help/first-sign-in/)
- [חיבור לרשות המסים למספרי הקצאה](https://open-ledger.dev/help/tax-authority/)
- [מהצעת מחיר לקבלה: המסמכים הראשונים](https://open-ledger.dev/help/first-invoice/)
- [חתימה דיגיטלית: מה רשות המסים דורשת ואיך הלדג'ר עומד בכל כלל](https://open-ledger.dev/help/digital-signature/)
- [גבייה עם גרואו, קארדקום או סולק אחר](https://open-ledger.dev/help/payment-providers/)
- [הכנסת הוצאות ללדג'ר](https://open-ledger.dev/help/expenses/)
- [שליחת מסמכים במייל, בלי ספאם](https://open-ledger.dev/help/email/)
- [חיבור Claude או אפליקציית AI אחרת (MCP)](https://open-ledger.dev/help/connect-claude/)
- [הוספה או החלפה של מפתח אחרי ההתקנה](https://open-ledger.dev/help/keys-later/)
- [עדכונים וגיבויים](https://open-ledger.dev/help/updates-backups/)
- [בעיות נפוצות ואיך פותרים אותן](https://open-ledger.dev/help/troubleshooting/)

Source: https://open-ledger.dev/help/users/
