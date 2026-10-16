# עדכונים וגיבויים

איך בודקים אם יש גרסה חדשה של Open Ledger IL ומעדכנים עם תוכנת ההתקנה, ואיפה הלדג'ר שומר גיבויים.

עודכן 2026-10-17

## בדיקת עדכונים

**Settings > Updates > Check for updates.** הלדג'ר בודק גם בכל 1 לחודש. שום דבר לא מותקן לבד.

## עדכון

1. פותחים את קישור ההורדה ממייל הרכישה. אם הוא כבר לא עובד, פותחים אותו בכל זאת ולוחצים **Email me a fresh link**.
2. מריצים את תוכנת ההתקנה החדשה על אותו חשבון Cloudflare, עם אותו מפתח רישיון.
3. היא מעדכנת את הלדג'ר ושומרת הכול: מסד הנתונים, הקבצים, הכניסה והמפתחות.

## גיבויים

- כל רבעון הלדג'ר כותב עותק מלא של מסד הנתונים ורשימה של כל הקבצים ל-bucket הגיבויים שלו, ובודק שהעותק משתחזר.
- כשגוגל דרייב מחובר, אותו עותק נשמר גם בדרייב, מחוץ ל-Cloudflare.
- כל לילה הלדג'ר בודק שאין חורים במספור ושאף מסמך לא השתנה. **Settings > Backups > Run check now** מריץ את הבדיקה מתי שרוצים.

## שומרים על חשבון Cloudflare

חשבון Cloudflare מחזיק את הספרים שלכם. מפעילים אימות דו-שלבי: dash.cloudflare.com, הפרופיל, **Authentication**, **Two-Factor Authentication**.

עדיין תקועים? [כתבו לנו מעמוד המחירים.](https://open-ledger.matanlevanon.com/he/pricing/#setup)

## עוד עזרה

- [לפני ההתקנה: מה צריך להכין](https://open-ledger.matanlevanon.com/he/help/before-you-start/)
- [התקנת Open Ledger IL צעד אחר צעד](https://open-ledger.matanlevanon.com/he/help/install/)
- [יצירת ה-API token ב-Cloudflare](https://open-ledger.matanlevanon.com/he/help/cloudflare-token/)
- [כניסה ראשונה והגדרות](https://open-ledger.matanlevanon.com/he/help/first-sign-in/)
- [גישה לרואה חשבון או לעוזר](https://open-ledger.matanlevanon.com/he/help/users/)
- [חיבור לרשות המסים למספרי הקצאה](https://open-ledger.matanlevanon.com/he/help/tax-authority/)
- [מהצעת מחיר לקבלה: המסמכים הראשונים](https://open-ledger.matanlevanon.com/he/help/first-invoice/)
- [גבייה עם גרואו, קארדקום או סולק אחר](https://open-ledger.matanlevanon.com/he/help/payment-providers/)
- [הכנסת הוצאות ללדג'ר](https://open-ledger.matanlevanon.com/he/help/expenses/)
- [שליחת מסמכים במייל, בלי ספאם](https://open-ledger.matanlevanon.com/he/help/email/)
- [חיבור Claude או אפליקציית AI אחרת (MCP)](https://open-ledger.matanlevanon.com/he/help/connect-claude/)
- [הוספה או החלפה של מפתח אחרי ההתקנה](https://open-ledger.matanlevanon.com/he/help/keys-later/)
- [בעיות נפוצות ואיך פותרים אותן](https://open-ledger.matanlevanon.com/he/help/troubleshooting/)

Source: https://open-ledger.matanlevanon.com/he/help/updates-backups/
