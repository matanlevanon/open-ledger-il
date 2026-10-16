# הכנסת הוצאות ללדג'ר

העלאת קבלות וחשבוניות ספקים, קריאה אוטומטית עם AI, ייבוא חודש מגוגל דרייב, ותיבת המייל שבדרך.

עודכן 2026-10-17

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

## בקרוב: העברת קבלות במייל

אנחנו בונים כתובת מייל פרטית לכל לדג'ר. מגדירים כלל אחד בג'ימייל או באאוטלוק שמעביר אליה קבלות, וכל קבלה מגיעה ל-**Expenses** כשהיא כבר נקראה ומחכה לבדיקה. בלי דרייב, בלי Google Cloud. העמוד הזה יסביר את ההגדרה כשהיא תעלה.

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
