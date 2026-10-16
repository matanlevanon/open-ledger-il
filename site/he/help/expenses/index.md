# הכנסת הוצאות ללדג'ר

העברת קבלות במייל, העלאה, או ייבוא חודש מגוגל דרייב. כל אחת נקראת עם AI ומחכה לבדיקה שלכם.

עודכן 2026-10-17

## העברת קבלות במייל

הדרך הכי קלה לקבלות שמגיעות למייל. ללדג'ר שלכם יש כתובת פרטית. כל מה שמועבר אליה הופך להוצאה, נקרא עם AI ומחכה לבדיקה שלכם.

### מוצאים את הכתובת

פותחים **Settings > Expenses > Email inbox**. הכתובת נראית כך: `r7k2m9x4qp@in.matanlevanon.com`. לוחצים **Copy**. תוכנת ההתקנה מגדירה אותה. אם העמוד אומר שהתיבה לא מוגדרת, מריצים שוב את תוכנת ההתקנה.

### הגדרה בג'ימייל, פעם אחת

1. בג'ימייל לוחצים על גלגל השיניים, אחר כך **See all settings** (הצגת כל ההגדרות), ואז הלשונית **Forwarding and POP/IMAP** (העברה ו-POP/IMAP).
2. לוחצים **Add a forwarding address** (הוספת כתובת להעברה), מדביקים את הכתובת ומאשרים.
3. ג'ימייל שולח קוד אישור לכתובת. הוא מופיע בלדג'ר תחת **Email inbox**: "Gmail sent a confirmation code". מקלידים את הקוד בג'ימייל ולוחצים **Verify**.
4. משאירים מסומן **Disable forwarding**. מעבירים רק קבלות, לא את כל המייל.
5. בתיבת החיפוש של ג'ימייל מדביקים את החיפוש מעמוד הלדג'ר, למשל `has:attachment (invoice OR receipt OR חשבונית OR קבלה)`. אפשר להוסיף ספקים: `from:(billing@supplier.com)`.
6. לוחצים על סמל אפשרויות החיפוש, ואז **Create filter** (יצירת מסנן). מסמנים **Forward it to** (העברה אל), בוחרים את הכתובת ולוחצים **Create filter**.

מעכשיו כל מייל מתאים מגיע ללדג'ר לבד. לשליחה ידנית, מעבירים לאותה כתובת.

### אאוטלוק

**Settings > Mail > Rules > Add new rule.** תנאי: **Has attachment**, ומילים בנושא כמו invoice או קבלה. פעולה: **Forward to** לכתובת.

### מה קורה לכל מייל

- כל קובץ מצורף מסוג PDF, JPG, PNG, WebP או HEIC הופך להוצאה אחת. תמונות לוגו קטנות מדולגות.
- מייל בלי קובץ מצורף הופך להוצאה אחת מהטקסט שלו, עם הסימון "From email text, check the amount".
- אותו קובץ פעמיים הוא הוצאה אחת.
- נספר רק מייל שהועבר מהכתובות שלכם. הרשימה נמצאת תחת **Allowed senders**, ומתחילה במיילים של הבעלים והעוזרים. כל השאר מתעלם ומופיע תחת **Last received**.
- הכתובת עוברת דרך שער המייל של MTN, שלא שומר כלום. עם דומיין משלכם ב-Cloudflare, מנתבים כתובת כמו `receipts@your-domain.co.il` ישר ללדג'ר. הקובץ `docs/expense-inbox.md` במאגר מסביר איך.

### כתובת חדשה

אם הכתובת דלפה או מקבלת ספאם, לוחצים **Make a new address**. הישנה מפסיקה מיד. מעדכנים את המסנן בג'ימייל עם החדשה.

## העלאה

הדרך המהירה.

1. פותחים **Expenses** ולוחצים **Upload expense**.
2. בוחרים קובץ: PDF, JPG או PNG. בטלפון, מצלמים את הקבלה.
3. עם מפתח Gemini או Anthropic, הלדג'ר קורא ספק, תאריך, סכומים ומע"מ וממלא אותם. בודקים ושומרים.
4. בלי מפתח, מקלידים את הפרטים לבד.

להוספת מפתח קריאה אחרי ההתקנה ראו [הוספה או החלפה של מפתח](https://open-ledger.matanlevanon.com/he/help/keys-later/).

## חודש מגוגל דרייב

למי שכבר שומר קבלות בדרייב, בתיקייה לכל חודש בשם `YYYY-MM`, למשל `2026-10`.

1. עוקבים אחרי הגדרת הדרייב במאגר הקוד: פרויקט ב-Google Cloud, הפעלת Drive API ו-Sheets API, Service Account, ושיתוף תיקיית ההוצאות איתו כעורך. המדריך הוא `docs/drive-expenses-setup.md` ב-GitHub.
2. נותנים ללדג'ר את מפתח ה-JSON של ה-Service Account כסוד `GOOGLE_SERVICE_ACCOUNT_JSON`, ראו [הוספה או החלפה של מפתח](https://open-ledger.matanlevanon.com/he/help/keys-later/).
3. ב-**Settings > Expenses** מדביקים את מזהה התיקייה, החלק בכתובת שלה אחרי `/folders/`, ולוחצים **Save folder**.
4. ב-**Expenses** בוחרים חודש ולוחצים **Import month**. כל קובץ נקרא עם AI ומחכה לבדיקה שלכם. הרצה כפולה לא מכפילה כלום.
5. לייבוא כל בוקר, מפעילים **Daily sync** ב-**Settings > Expenses**.

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
- [שליחת מסמכים במייל, בלי ספאם](https://open-ledger.matanlevanon.com/he/help/email/)
- [חיבור Claude או אפליקציית AI אחרת (MCP)](https://open-ledger.matanlevanon.com/he/help/connect-claude/)
- [הוספה או החלפה של מפתח אחרי ההתקנה](https://open-ledger.matanlevanon.com/he/help/keys-later/)
- [עדכונים וגיבויים](https://open-ledger.matanlevanon.com/he/help/updates-backups/)
- [בעיות נפוצות ואיך פותרים אותן](https://open-ledger.matanlevanon.com/he/help/troubleshooting/)

Source: https://open-ledger.matanlevanon.com/he/help/expenses/
