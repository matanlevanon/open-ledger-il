# שליחת מסמכים במייל, בלי ספאם

חיבור Resend כדי שהלדג'ר ישלח קבלות וחשבוניות מהדומיין שלכם, והגדרות ה-DNS והניסוח שמשאירים אותן בתיבה הראשית.

עודכן 2026-10-17

הלדג'ר שולח מיילים דרך Resend, שירות שליחה עם תוכנית חינמית. Resend שולח רק מדומיין שלכם ומאומת. בלי דומיין, מורידים כל PDF או משתמשים בכפתור הוואטסאפ בעמוד המסמך.

## הגדרת Resend

1. נרשמים ב-resend.com.
2. פותחים **Domains**, לוחצים **Add Domain** ומקלידים את הדומיין, למשל `acme.co.il`.
3. Resend מציג רשומות DNS: אחת או שתיים ל-DKIM, אחת ל-SPF, ו-MX על תת-דומיין `send.`. מוסיפים אותן איפה שה-DNS של הדומיין מנוהל. ב-Cloudflare, Resend מציע להוסיף אותן בשבילכם.
4. מחכים ל-**Verified**. דקות, לפעמים שעה.
5. פותחים **API Keys**, לוחצים **Create API Key**, בוחרים **Sending access** ומעתיקים את המפתח. הוא מתחיל ב-`re_`.
6. נותנים אותו ללדג'ר בשלב התוספות של תוכנת ההתקנה, או אחר כך כסוד `MAIL_API_KEY` יחד עם המשתנה `MAIL_FROM`, ראו [הוספה או החלפה של מפתח](https://open-ledger.matanlevanon.com/he/help/keys-later/).

`MAIL_FROM` הוא השם והכתובת שהלקוחות רואים, למשל `Acme Ltd <billing@acme.co.il>`. הכתובת חייבת להיות על הדומיין המאומת.

## איך לא להגיע לספאם

1. **DMARC.** מוסיפים רשומת TXT בשם `_dmarc` עם הערך `v=DMARC1; p=none;`. אחרי שבועיים של דוחות נקיים, משנים `p=none` ל-`p=quarantine`. ג'ימייל ויאהו מצפים לרשומת DMARC מכל שולח.
2. **מכבים מעקב.** ב-Resend, **Domains >** הדומיין שלכם **> Configuration**: מכבים open tracking ו-click tracking. פיקסלים של מעקב וקישורים מוחלפים דוחפים מיילים לקידומי מכירות ולספאם.
3. **כתובת שעונים ממנה.** שולחים מכתובת שמקבלת מייל, כמו `billing@` עם תיבה או הפניה מאחוריה. תשובות מראות לג'ימייל שאנשים רוצים את המייל שלכם.
4. **שולח אחד רק למסמכים.** לא שולחים ניוזלטרים מהכתובת ששולחת קבלות.
5. **בודקים פעם אחת.** שולחים קבלה לג'ימייל שלכם, פותחים, לוחצים על שלוש הנקודות, **Show original**, ובודקים ש-SPF, DKIM ו-DMARC מראים **PASS**.

## המייל הראשון ללקוח

הלדג'ר מבקש הסכמה של הלקוח לפני המסמך הדיגיטלי הראשון. בקשו מהלקוח להוסיף את הכתובת שלכם לאנשי הקשר, והבאים יגיעו לתיבה הראשית.

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
- [חיבור Claude או אפליקציית AI אחרת (MCP)](https://open-ledger.matanlevanon.com/he/help/connect-claude/)
- [הוספה או החלפה של מפתח אחרי ההתקנה](https://open-ledger.matanlevanon.com/he/help/keys-later/)
- [עדכונים וגיבויים](https://open-ledger.matanlevanon.com/he/help/updates-backups/)
- [בעיות נפוצות ואיך פותרים אותן](https://open-ledger.matanlevanon.com/he/help/troubleshooting/)

Source: https://open-ledger.matanlevanon.com/he/help/email/
