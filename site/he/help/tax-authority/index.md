# חיבור לרשות המסים למספרי הקצאה

מחברים את הלדג'ר לרשות המסים פעם אחת, כדי שחשבוניות מס יקבלו מספר הקצאה לבד, ומתחברים מחדש כל 90 יום.

עודכן 2026-10-17

חשבונית מס לעוסק מורשה ישראלי מעל הסף צריכה מספר הקצאה מרשות המסים. עם החיבור, הלדג'ר מבקש את המספר כשמסיימים את החשבונית ומדפיס אותו על המסמך.

עוסק פטור לא מוציא חשבוניות מס, ולכן לא צריך חיבור. מתחברים כשעוברים לעוסק מורשה.

## התחברות

1. בלדג'ר פותחים **ITA** בתפריט הצד.
2. לוחצים **Connect to ITA**.
3. נפתח עמוד הכניסה של רשות המסים. נכנסים עם המשתמש שלכם ברשות המסים: קוד המשתמש והקוד החד פעמי שמגיע לטלפון. משתמשים במשתמש של העסק עצמו, זה של מספר העוסק שלו.
4. מאשרים את הבקשה. חוזרים ללדג'ר, והעמוד מציג **Connected** עם מספר הימים שנשארו.

המהדורה המחוברת עוברת דרך האפליקציה המאושרת של MTN ברשות המסים, אז אין צורך לרשום אפליקציה משלכם.

## כל 90 יום

הכניסה לרשות המסים תקפה 90 יום. עמוד ITA מציג **Login ends in N days**. עם התראות Slack, הלדג'ר מזהיר מראש. כשהיא נגמרת, פותחים **ITA** ולוחצים **Connect again**. חשבונית שעדיין מחכה למספר מופיעה ב-**Allocation queue** באותו עמוד. אחרי ההתחברות לוחצים **Retry now**.

## כשמספר נדחה

עמוד ITA מציג את הסיבה. האפשרויות הן לבטל את החשבונית, להמשיך בלי מספר עם הודעה על המסמך, או לעבור לחיוב עצמי (reverse charge) בהסכמת הלקוח. שאלו את רואה החשבון מה מתאים.

עדיין תקועים? [כתבו לנו מעמוד המחירים.](https://open-ledger.matanlevanon.com/he/pricing/#setup)

## עוד עזרה

- [לפני ההתקנה: מה צריך להכין](https://open-ledger.matanlevanon.com/he/help/before-you-start/)
- [התקנת Open Ledger IL צעד אחר צעד](https://open-ledger.matanlevanon.com/he/help/install/)
- [יצירת ה-API token ב-Cloudflare](https://open-ledger.matanlevanon.com/he/help/cloudflare-token/)
- [כניסה ראשונה והגדרות](https://open-ledger.matanlevanon.com/he/help/first-sign-in/)
- [גישה לרואה חשבון או לעוזר](https://open-ledger.matanlevanon.com/he/help/users/)
- [מהצעת מחיר לקבלה: המסמכים הראשונים](https://open-ledger.matanlevanon.com/he/help/first-invoice/)
- [גבייה עם גרואו, קארדקום או סולק אחר](https://open-ledger.matanlevanon.com/he/help/payment-providers/)
- [הכנסת הוצאות ללדג'ר](https://open-ledger.matanlevanon.com/he/help/expenses/)
- [שליחת מסמכים במייל, בלי ספאם](https://open-ledger.matanlevanon.com/he/help/email/)
- [חיבור Claude או אפליקציית AI אחרת (MCP)](https://open-ledger.matanlevanon.com/he/help/connect-claude/)
- [הוספה או החלפה של מפתח אחרי ההתקנה](https://open-ledger.matanlevanon.com/he/help/keys-later/)
- [עדכונים וגיבויים](https://open-ledger.matanlevanon.com/he/help/updates-backups/)
- [בעיות נפוצות ואיך פותרים אותן](https://open-ledger.matanlevanon.com/he/help/troubleshooting/)

Source: https://open-ledger.matanlevanon.com/he/help/tax-authority/
