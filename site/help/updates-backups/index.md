# עדכונים וגיבויים

איך בודקים אם יש גרסה חדשה של Open Ledger IL ומעדכנים עם תוכנת ההתקנה, ואיפה הלדג'ר שומר גיבויים.

עודכן 2026-10-20

## בדיקת עדכונים

**Settings > Updates > Check for updates.** הלדג'ר בודק גם בכל 1 לחודש. שום דבר לא מותקן לבד.

## עדכון

1. מריצים שוב את אותה תוכנת התקנה: `MTN-Open-Ledger-Setup.exe`, הקובץ ששמרתם. היא מורידה את הלדג'ר העדכני בזמן שהיא רצה. הקובץ אבד? פותחים את קישור ההורדה ממייל הרכישה. אם הוא כבר לא עובד, פותחים אותו בכל זאת ולוחצים **Email me a fresh link**.
2. מריצים אותה על אותו חשבון Cloudflare, עם אותו מפתח רישיון.
3. היא מעדכנת את הלדג'ר ושומרת הכול: מסד הנתונים, הקבצים, הכניסה והמפתחות.

אחרי שמדביקים את טוקן ה-Cloudflare, תוכנת ההתקנה מוצאת את הלדג'ר בחשבון וממלאת ממנו את פרטי העסק. כתובת האתר וסוג העסק נעולים בעדכון. מפתחות שכבר הוגדרו נשארים כמו שהם כשמשאירים את השדה שלהם ריק. הסיכום לפני **Update** מציג את המעבר, למשל **Updates your Ledger from 1.5.0 to 1.6.0**. אם תוכנת ההתקנה אומרת שהיא ישנה מדי ללדג'ר הנוכחי, מורידים את תוכנת ההתקנה החדשה ממייל הרכישה. באותו מחשב התוכנה זוכרת גם את התשובות מההרצה הקודמת, ואת הטוקן אם מסמנים **Remember the token on this computer** (רק ב-Windows, שמור מוצפן למשתמש ה-Windows שלכם).

## גיבויים

- כל רבעון הלדג'ר כותב עותק מלא של מסד הנתונים ורשימה של כל הקבצים ל-bucket הגיבויים שלו, ובודק שהעותק משתחזר.
- כשגוגל דרייב מחובר, אותו עותק נשמר גם בדרייב, מחוץ ל-Cloudflare.
- כל לילה הלדג'ר בודק שאין חורים במספור ושאף מסמך לא השתנה. **Settings > Backups > Run check now** מריץ את הבדיקה מתי שרוצים.

## שומרים על חשבון Cloudflare

חשבון Cloudflare מחזיק את הספרים שלכם. מפעילים אימות דו-שלבי: dash.cloudflare.com, סמל האדם בפינה הימנית העליונה, **Profile**, ואז **Access Management > Authentication**, **Two-Factor Authentication**.

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
- [הוספה או החלפה של מפתח אחרי ההתקנה](https://open-ledger.dev/help/keys-later/)
- [בעיות נפוצות ואיך פותרים אותן](https://open-ledger.dev/help/troubleshooting/)

Source: https://open-ledger.dev/help/updates-backups/
