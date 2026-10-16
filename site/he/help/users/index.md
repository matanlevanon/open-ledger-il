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

1. נכנסים ל-dash.cloudflare.com ופותחים **Zero Trust**.
2. נכנסים ל-**Access > Applications** ופותחים את **MTN Open Ledger**.
3. פותחים את הלשונית **Policies** ועורכים את מדיניות הכניסה.
4. תחת **Include > Emails** מוסיפים את המייל.
5. לוחצים **Save**.

עד שלב 5, Cloudflare עוצר את האדם בעמוד הכניסה שלו.

## הסרת אדם

1. בלדג'ר: **Accountant > Users**, לוחצים **Revoke** בשורה שלו.
2. ב-Cloudflare Access: מוחקים את המייל מ-**Include > Emails** ושומרים.

עדיין תקועים? [כתבו לנו מעמוד המחירים.](https://open-ledger.matanlevanon.com/he/pricing/#setup)

## עוד עזרה

- [לפני ההתקנה: מה צריך להכין](https://open-ledger.matanlevanon.com/he/help/before-you-start/)
- [התקנת Open Ledger IL צעד אחר צעד](https://open-ledger.matanlevanon.com/he/help/install/)
- [יצירת ה-API token ב-Cloudflare](https://open-ledger.matanlevanon.com/he/help/cloudflare-token/)
- [כניסה ראשונה והגדרות](https://open-ledger.matanlevanon.com/he/help/first-sign-in/)
- [חיבור לרשות המסים למספרי הקצאה](https://open-ledger.matanlevanon.com/he/help/tax-authority/)
- [מהצעת מחיר לקבלה: המסמכים הראשונים](https://open-ledger.matanlevanon.com/he/help/first-invoice/)
- [גבייה עם גרואו, קארדקום או סולק אחר](https://open-ledger.matanlevanon.com/he/help/payment-providers/)
- [הכנסת הוצאות ללדג'ר](https://open-ledger.matanlevanon.com/he/help/expenses/)
- [שליחת מסמכים במייל, בלי ספאם](https://open-ledger.matanlevanon.com/he/help/email/)
- [חיבור Claude או אפליקציית AI אחרת (MCP)](https://open-ledger.matanlevanon.com/he/help/connect-claude/)
- [הוספה או החלפה של מפתח אחרי ההתקנה](https://open-ledger.matanlevanon.com/he/help/keys-later/)
- [עדכונים וגיבויים](https://open-ledger.matanlevanon.com/he/help/updates-backups/)
- [בעיות נפוצות ואיך פותרים אותן](https://open-ledger.matanlevanon.com/he/help/troubleshooting/)

Source: https://open-ledger.matanlevanon.com/he/help/users/
