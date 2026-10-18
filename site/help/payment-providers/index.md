# גבייה עם גרואו, קארדקום או סולק אחר

סולק גובה את הכסף והלדג'ר מוציא את הקבלות, ידנית או אוטומטית, בלי שני מסמכים לאותו תשלום.

עודכן 2026-10-17

הלדג'ר מוציא את המסמכים. סולק כמו Grow, Cardcom, PayPlus או ביט גובה את הכסף. השניים עובדים זה לצד זה.

## קודם כול: מכבים את המסמכים של הסולק

רוב הסולקים מוציאים קבלה או חשבונית משלהם על כל תשלום. מכבים את זה בהגדרות של הסולק, או מבקשים מהתמיכה שלהם. אחרת כל תשלום מקבל שני מסמכים עם שני מספרים שונים, והספרים מפסיקים להתאים לבנק.

## דרך 1: ידנית

1. בלדג'ר מוסיפים את קישור התשלום של הסולק כאמצעי תשלום: **Settings > Payment methods**, סוג **Card** או **Other**, ומדביקים את הקישור.
2. שולחים ללקוח דרישת תשלום עם אמצעי התשלום הזה מסומן.
3. כשהסולק מודיע שהכסף נכנס, פותחים את דרישת התשלום ולוחצים **Record payment**. בוחרים **Card** ומדביקים את מספר העסקה של הסולק כאסמכתא.
4. הלדג'ר מוציא את הקבלה. שולחים אותה ללקוח.

שתי דקות לתשלום. מתאים לעסק עם כמה תשלומים בשבוע.

## דרך 2: אוטומטית, למי שמכיר אוטומציות

ללדג'ר יש נקודת חיבור MCP, דלת לתוכנות אחרות, בכתובת שלו עם `/mcp` בסוף. היא מקבלת קריאות JSON-RPC (`tools/call`) עם הכותרת `Authorization: Bearer` וטוקן ה-MCP שלכם. בין הכלים: `list_clients`, `create_draft`, `finalize_document`, `record_payment` ו-`add_expense`.

כלי אוטומציה כמו Make, Zapier או n8n מחבר את הסולק אליה:

1. בסולק מפעילים webhook לתשלום שהצליח ומכוונים אותו לתרחיש חדש.
2. בתרחיש מוצאים את הלקוח עם `list_clients`, לפי שם או מייל של המשלם.
3. רושמים את התשלום על דרישת התשלום הפתוחה עם `record_payment` ו-`confirm: true`. התרחיש צריך את מזהה המסמך של דרישת התשלום. מחזיקים טבלה קטנה של קישור תשלום מול מזהה מסמך, ומעדכנים אותה כששולחים כל דרישה.
4. הלדג'ר מוציא את הקבלה.

ההקמה והבדיקה לוקחות אחר צהריים. מתחילים עם תשלום קטן אחד. לטוקן ה-MCP ראו [חיבור Claude או אפליקציה אחרת](https://open-ledger.dev/help/connect-claude/).

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
- [הכנסת הוצאות ללדג'ר](https://open-ledger.dev/help/expenses/)
- [שליחת מסמכים במייל, בלי ספאם](https://open-ledger.dev/help/email/)
- [חיבור Claude או אפליקציית AI אחרת (MCP)](https://open-ledger.dev/help/connect-claude/)
- [הוספה או החלפה של מפתח אחרי ההתקנה](https://open-ledger.dev/help/keys-later/)
- [עדכונים וגיבויים](https://open-ledger.dev/help/updates-backups/)
- [בעיות נפוצות ואיך פותרים אותן](https://open-ledger.dev/help/troubleshooting/)

Source: https://open-ledger.dev/help/payment-providers/
