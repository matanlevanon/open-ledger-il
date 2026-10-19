# יצירת ה-API token ב-Cloudflare

שורות ההרשאה המדויקות, החשבון וה-Zone של הטוקן שתוכנת ההתקנה צריכה, עם דומיין ובלי דומיין.

עודכן 2026-10-18

הטוקן הוא סיסמה עם הרשאות מוגבלות. הוא מאפשר לתוכנת ההתקנה ליצור את הלדג'ר בחשבון Cloudflare שלכם. מוחקים אותו אחרי ההתקנה.

## פותחים את עמוד הטוקנים

1. פותחים את dash.cloudflare.com/profile/api-tokens בלשונית חדשה. משאירים את תוכנת ההתקנה פתוחה. בלוח הבקרה זה סמל האדם בפינה הימנית העליונה, **Profile**, ואז **API Tokens**.
2. לוחצים **Create Token**.
3. גוללים לתחתית רשימת התבניות. מוצאים **Custom token** ולוחצים **Get started**.
4. Token name: כל שם, למשל `Ledger install`.

## מוסיפים את שורות ההרשאה

לכל שורה שלוש תיבות: הסוג (**Account** או **Zone**), ההרשאה, והרמה (**Read** או **Edit**). השורה הראשונה כבר קיימת. לכל שורה נוספת לוחצים **+ Add more**.

מוסיפים את שש השורות האלה:

1. Account | Workers Scripts | Edit
2. Account | D1 | Edit
3. Account | Workers R2 Storage | Edit
4. Account | Access: Apps and Policies | Edit
5. Account | Access: Organizations, Identity Providers, and Groups | Read
6. Account | Account Settings | Read

רק אם יש בחשבון דומיין, מוסיפים עוד שלוש:

1. Zone | Zone | Read
2. Zone | Workers Routes | Edit
3. Zone | DNS | Edit

איך יודעים אם יש דומיין: ב-dash.cloudflare.com, **Domains** בתפריט השמאלי מציג אותו. בחשבון חדש אין.

## Account Resources ו-Zone Resources

1. מתחת להרשאות, ב-**Account Resources**, בוחרים **Include** ואז את החשבון של העסק.
2. **Zone Resources** מופיע רק אחרי שמוסיפים שורת Zone. עם דומיין: **Include**, אחר כך **Specific zone**, ואז הדומיין שהלדג'ר ישתמש בו. בלי דומיין לא הוספתם שורות Zone, אז החלק הזה לא מופיע. מדלגים.
3. **Client IP Address Filtering**: משאירים ריק. **TTL**: לא חובה. קובעים תאריך סיום, למשל שנה מהיום, והטוקן מפסיק לעבוד אחריו. מומלץ אם מסמנים **Remember the token on this computer** בתוכנת ההתקנה.

## יוצרים ומעתיקים

1. לוחצים **Continue to summary** ואז **Create Token**.
2. לוחצים **Copy** ליד הטוקן. Cloudflare מציג אותו פעם אחת. אם הוא אבד, יוצרים חדש באותה דרך.
3. מדביקים בתוכנת ההתקנה ולוחצים **Check token**.

## אם Check token נכשל

- **חסרה הרשאה:** ההודעה אומרת איזו. עורכים את הטוקן בעמוד הטוקנים, מוסיפים את השורה, שומרים ולוחצים **Check token** שוב. הטוקן עצמו לא משתנה.
- **חשבון לא נכון:** ה-**Account Resources** של הטוקן מצביע על חשבון אחר. עורכים ובוחרים את הנכון.
- **הודבק עם רווח:** מעתיקים שוב עם כפתור **Copy**.
- **Zero Trust או R2 עוד לא הופעלו:** מסיימים קודם את שלב 1 בתוכנת ההתקנה.

עדיין תקועים? [כתבו לנו מעמוד המחירים.](https://open-ledger.dev/pricing/#setup)

## עוד עזרה

- [לפני ההתקנה: מה צריך להכין](https://open-ledger.dev/help/before-you-start/)
- [התקנת Open Ledger IL צעד אחר צעד](https://open-ledger.dev/help/install/)
- [כניסה ראשונה והגדרות](https://open-ledger.dev/help/first-sign-in/)
- [גישה לרואה חשבון או לעוזר](https://open-ledger.dev/help/users/)
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

Source: https://open-ledger.dev/help/cloudflare-token/
