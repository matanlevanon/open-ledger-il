# לפני ההתקנה: מה צריך להכין

החשבונות, הפרטים וחצי השעה שצריך לפני שמריצים את תוכנת ההתקנה של Open Ledger IL, ומה מהם לא חובה.

עודכן 2026-10-17

התקנה ראשונה לוקחת בערך 30 דקות. רוב הזמן הולך על פתיחת חשבונות. כדאי להכין את אלה מראש.

## חובה

- **מחשב Windows.** תוכנת ההתקנה רצה על Windows 10 או 11. אחרי ההתקנה הלדג'ר נפתח בכל דפדפן, בכל מחשב ובטלפון.
- **מפתח הרישיון** מהמייל של הרכישה. הוא נראה כך: `OL-XXXX-XXXX-XXXX-XXXX`. מפתח אחד לעסק אחד.
- **פרטי העסק:** שם העסק כפי שיופיע על המסמכים, המייל של הבעלים, ומספר העוסק בן 9 הספרות (ת"ז לעוסק יחיד, ח.פ. לחברה). המפתח עובד רק למספר הזה.
- **כתובת מייל שאתם קוראים.** היא הכניסה של הבעלים. Cloudflare שולח אליה קוד חד פעמי בכל כניסה.
- **כרטיס אשראי.** Cloudflare מבקש כרטיס כדי להפעיל שני שירותים חינמיים, Zero Trust ו-R2. התוכניות החינמיות עולות $0 ולא יורד שום חיוב.

## לא חובה

אפשר להוסיף כל אחד מאלה בזמן ההתקנה או אחריה.

- **דומיין**, למשל acme.co.il, שכבר נמצא בחשבון Cloudflare שלכם. בלי דומיין, הלדג'ר עולה על כתובת חינמית של Cloudflare שנגמרת ב-workers.dev. ראו [דומיין או workers.dev](https://open-ledger.matanlevanon.com/he/help/install/).
- **מפתח API של Gemini או Anthropic**, כדי שהלדג'ר יקרא בשבילכם קבלות וחשבוניות של ספקים. בלי מפתח, מקלידים את פרטי ההוצאה ביד.
- **מפתח API של Resend**, כדי שהלדג'ר ישלח מסמכים ללקוחות במייל. Resend דורש דומיין. בלי דומיין, מורידים כל PDF או שולחים בוואטסאפ.
- **Webhook של Slack**, להתראות כמו כניסה לרשות המסים שעומדת להסתיים.

## של מי מה

הכול נוצר בחשבונות שלכם ועל שמכם: חשבון Cloudflare, מסד הנתונים, הקבצים. ל-MTN אין גישה לנתונים שלכם. הקשר היחיד ל-MTN הוא החיבור לרשות המסים במהדורה המחוברת, שמעביר את בקשות מספרי ההקצאה דרך האפליקציה המאושרת של MTN.

## הצעד הבא

[התקנה עם תוכנת ההתקנה](https://open-ledger.matanlevanon.com/he/help/install/).

עדיין תקועים? [כתבו לנו מעמוד המחירים.](https://open-ledger.matanlevanon.com/he/pricing/#setup)

## עוד עזרה

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
- [עדכונים וגיבויים](https://open-ledger.matanlevanon.com/he/help/updates-backups/)
- [בעיות נפוצות ואיך פותרים אותן](https://open-ledger.matanlevanon.com/he/help/troubleshooting/)

Source: https://open-ledger.matanlevanon.com/he/help/before-you-start/
