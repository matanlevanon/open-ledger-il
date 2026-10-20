# בעיות נפוצות ואיך פותרים אותן

פתרונות למקומות שבהם נתקעים: אזהרות Windows, הטוקן של Cloudflare, Zero Trust, מפתחות שנדחים, כניסה, הורדות ומייל.

עודכן 2026-10-17

## תוכנת ההתקנה

- **Windows protected your PC.** לוחצים **More info** ואז **Run anyway**.
- **האנטי-וירוס מחק את הקובץ.** משחזרים אותו מההסגר של האנטי-וירוס ומאשרים, או מורידים שוב ממייל הרכישה.
- **לחיצה כפולה ושום דבר לא נפתח.** מחכים 20 שניות, הקובץ גדול. תוכנת ההתקנה פותחת לשונית בדפדפן בכתובת שמתחילה ב-`http://127.0.0.1`. אם לא נפתחה לשונית, מעתיקים את הכתובת מהחלון השחור הקטן לדפדפן.
- **מפתח הרישיון נדחה.** מקלידים אותו בצורה `OL-XXXX-XXXX-XXXX-XXXX` ובודקים את מספר העוסק. המפתח עובד רק למספר שבשבילו נקנה. התקנה חוזרת של אותו עסק עם אותו מפתח עובדת.

## Cloudflare

- **אין Zone Resources.** הוא מופיע רק אחרי שורת הרשאה מסוג Zone. בלי דומיין, מדלגים ומשתמשים בכתובת החינמית של workers.dev. ראו [יצירת ה-API token](https://open-ledger.dev/help/cloudflare-token/).
- **Check token נכשל.** ההודעה אומרת איזו הרשאה חסרה. עורכים את הטוקן, מוסיפים את השורה, שומרים ובודקים שוב.
- **Zero Trust או R2 מבקשים כרטיס.** שתי התוכניות החינמיות מבקשות אמצעי תשלום ולא מחייבות.
- **Purchase R2 Plan.** בתפריט השמאלי, **Storage & databases > R2 Object Storage**. לוחצים ומאשרים את התוכנית החינמית. 10GB הראשונים בחודש בחינם.

## מפתחות

- **מפתח Gemini נדחה.** מפתחות חדשים מ-Google AI Studio מתחילים ב-`AQ.`. תוכנת ההתקנה של גרסה 1.6.0 מ-17 באוקטובר 2026 מקבלת אותם. עם תוכנת התקנה ישנה, בוחרים **No** בקריאת הוצאות ומוסיפים את המפתח אחר כך, ראו [הוספה או החלפה של מפתח](https://open-ledger.dev/help/keys-later/).
- **מפתח Anthropic נדחה.** הוא מתחיל ב-`sk-ant-`. מעתיקים אותו שוב מ-console.anthropic.com.

## כניסה

- **עמוד של Cloudflare מבקש מייל.** זו הכניסה. מקלידים את מייל הבעלים ומדביקים את הקוד מהמייל.
- **הקוד לא מגיע.** בודקים בספאם, ובודקים שזה המייל שהוזן בתוכנת ההתקנה.
- **מישהו אחר נעצר בעמוד של Cloudflare.** מוסיפים את המייל שלו ב-Cloudflare Access, ראו [גישה לרואה חשבון](https://open-ledger.dev/help/users/).

## הורדות ומייל

- **קישור ההורדה פג או נגמר.** לוחצים **Email me a fresh link** באותו עמוד.
- **לקוחות מקבלים את המסמכים בספאם.** ראו [שליחת מסמכים בלי ספאם](https://open-ledger.dev/help/email/).
- **טוקן ה-MCP אבד.** ראו [חיבור Claude](https://open-ledger.dev/help/connect-claude/).

## רשות המסים

- **ITA מבקש להתחבר מחדש.** הכניסה תקפה 90 יום. פותחים **ITA** ולוחצים **Connect again**.
- **חשבונית מחכה למספר 24 שעות.** מבקשים את המספר באתר של רשות המסים ומקלידים אותו בעמוד ITA.

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
- [API לאפליקציות אחרות](https://open-ledger.dev/help/api/)
- [הוספה או החלפה של מפתח אחרי ההתקנה](https://open-ledger.dev/help/keys-later/)
- [עדכונים וגיבויים](https://open-ledger.dev/help/updates-backups/)

Source: https://open-ledger.dev/help/troubleshooting/
